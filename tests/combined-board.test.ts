import { describe, expect, it } from "vitest";
import { boardEntryKey, combinedItems } from "../src/lib/combined-board";
import { demo } from "../src/lib/demo";
import { sortedIssues } from "../src/lib/model";
const filters = { query: "", repositoryQueries: {}, hideCoordination: false };
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
  it("requires global and local filters while isolating repositories and coordination", () => {
    const lanes = demo();
    const result = combinedItems(lanes, "backlog", {}, { query: "PRIORITY: HIGH", repositoryQueries: { "demo/design-system": "missing" }, hideCoordination: true });
    expect(result.map(entry => entry.lane.repo.name).sort()).toEqual(["personal-website", "weekend-project"]);
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
});
