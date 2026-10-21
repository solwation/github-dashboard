import { describe, expect, it } from "vitest";
import { boardEntryKey, combinedItems } from "../src/lib/combined-board";
import { demo } from "../src/lib/demo";
import { sortedIssues } from "../src/lib/model";
const filters = { query: "", hideCoordination: false };
describe("combined issue columns", () => {
  it("keeps the existing sort order when only one repository is selected", () => {
    const [lane] = demo();
    for (const key of ["backlog", "progress", "closed"]) expect(combinedItems([lane!], key, {}, filters).map(entry => entry.issue)).toEqual(sortedIssues(lane!.issues, key));
  });
  it("applies workflow and priority overrides from each issue's own repository", () => {
    const [first, second] = demo();
    first!.issues = [{ ...first!.issues[0]!, labels: [{ name: "urgent", color: "fff" }], created_at: "2026-01-02" }, { ...first!.issues[1]!, labels: [{ name: "Building", color: "fff" }], startedAt: "2026-01-01" }];
    second!.issues = [{ ...second!.issues[0]!, created_at: "2026-01-01" }, { ...second!.issues[1]!, startedAt: "2026-01-02" }];
    const rules = { [first!.repo.full_name]: { high: "urgent", progress: "Building" } };
    const lanes = [first!, second!];
    expect(combinedItems(lanes, "backlog", rules, filters).map(entry => entry.lane.repo.name)).toEqual([second!.repo.name, first!.repo.name]);
    expect(combinedItems(lanes, "progress", rules, filters).map(entry => entry.lane.repo.name)).toEqual([first!.repo.name, second!.repo.name]);
  });
  it("applies the main search across repositories and hides coordination", () => {
    const lanes = demo();
    const result = combinedItems(lanes, "backlog", {}, { query: "PRIORITY: HIGH", hideCoordination: true });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every(entry => entry.issue.labels.some(label => label.name.toLowerCase().includes("priority: high")))).toBe(true);
    lanes[0]!.issues[0]!.labels.push({ name: "agent coordination", color: "fff" });
    expect(combinedItems([lanes[0]!], "backlog", {}, { ...filters, hideCoordination: true }).some(entry => entry.issue.id === lanes[0]!.issues[0]!.id)).toBe(false);
  });
  it("uses repository identity for colliding IDs and keeps pending data out of columns", () => {
    const [first, second] = demo();
    const issue = first!.issues[0]!;
    second!.issues = [{ ...issue }]; first!.issues = [issue];
    const entries = combinedItems([first!, second!], "backlog", {}, filters);
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map(entry => boardEntryKey(entry, "backlog"))).size).toBe(2);
    expect(combinedItems([{ ...first!, loading: true }, second!], "backlog", {}, filters)).toHaveLength(1);
  });
  it("sorts closed issues newest first and does not mutate source issue arrays", () => {
    const lanes = demo(); const before = lanes.map(lane => [...lane.issues]);
    const result = combinedItems(lanes, "closed", {}, filters);
    expect(result.every((entry, index) => index === 0 || Date.parse(result[index - 1]!.issue.closed_at!) >= Date.parse(entry.issue.closed_at!))).toBe(true);
    lanes.forEach((lane, index) => expect(lane.issues).toEqual(before[index]));
  });
  it("orders each column by the requested age and priority keys in single and combined boards", () => {
    const [first, second] = demo();
    const make = (lane: typeof first, id: number, labels: string[], dates: { created?: string; started?: string; closed?: string }) => ({
      ...lane!.issues[0]!,
      id,
      number: id,
      labels: labels.map(name => ({ name, color: "fff" })),
      state: dates.closed ? "closed" : "open",
      created_at: dates.created ?? "2026-01-01T00:00:00Z",
      startedAt: dates.started ?? null,
      closed_at: dates.closed ?? null,
    });
    const oldLow = make(first, 101, ["priority: low"], { created: "2026-01-01T00:00:00Z" });
    const recentHigh = make(second, 202, ["priority: high"], { created: "2026-01-03T00:00:00Z" });
    const oldHigh = make(first, 103, ["priority: high"], { created: "2026-01-02T00:00:00Z" });
    const longRunning = make(first, 104, ["in-progress"], { started: "2026-01-01T00:00:00Z" });
    const shortRunning = make(second, 205, ["in-progress"], { started: "2026-01-03T00:00:00Z" });
    const newlyClosed = make(first, 106, [], { closed: "2026-01-03T00:00:00Z" });
    const longClosed = make(second, 207, [], { closed: "2026-01-01T00:00:00Z" });
    first!.issues = [oldLow, oldHigh, longRunning, newlyClosed];
    second!.issues = [recentHigh, shortRunning, longClosed];
    const lanes = [first!, second!];
    const cases = [
      ["backlog", [103, 202, 101]],
      ["progress", [104, 205]],
      ["closed", [106, 207]],
    ] as const;
    for (const [key, expected] of cases) {
      expect(sortedIssues(lanes.flatMap(lane => lane.issues), key).map(issue => issue.id)).toEqual(expected);
      expect(combinedItems(lanes, key, {}, filters).map(entry => entry.issue.id)).toEqual(expected);
    }
  });
});
