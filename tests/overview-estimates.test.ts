import { describe, expect, it } from "vitest";
import { overviewEstimateGroups, overviewPoints, overviewTimeEstimate } from "../src/lib/overview-estimates";
import type { Issue, Lane } from "../src/lib/model";
const minute = 60000, day = 86400000, now = Date.parse("2026-10-20T12:00:00Z");
const iso = (at: number) => new Date(at).toISOString();
const issue = (id: number, points = 1, extra: Partial<Issue> = {}): Issue => ({ id, number: id, title: "Work", state: "open", labels: [{ name: `points: ${points}`, color: "" }], assignees: [], html_url: "", closed_at: null, created_at: iso(now - 5 * day), updated_at: iso(now), ...extra });
const progress = (id: number, elapsed = 10 * minute) => issue(id, 1, { labels: [{ name: "in-progress", color: "" }, { name: "points: 1", color: "" }], startedAt: iso(now - elapsed) });
const history = (duration = 30 * minute) => [1, 2, 3].map(id => issue(id, 1, { state: "closed", closed_at: iso(now - id * day), workStartedAt: iso(now - id * day - duration) }));
const lane = (issues: Issue[], repository = "a/b"): Lane => ({ repo: { id: 1, name: "b", full_name: repository, description: null, private: true, html_url: "", owner: { login: "a" } }, issues, labels: [] });
const groups = (lanes: Lane[]) => overviewEstimateGroups(lanes, {}, true);

describe("overview estimate scope", () => {
  it("includes progress among open points, excludes closed/PR/coordination, and deduplicates per repository", () => {
    const data = [issue(10, 3), progress(11), issue(12, 13, { labels: [{ name: "orkester", color: "" }] }), issue(13, 13, { pull_request: {} }), ...history()];
    const selection = groups([lane(data), lane(data), lane([issue(10, 2)], "a/c")]);
    expect(overviewPoints(selection, "open")).toBe(6);
    expect(overviewPoints(selection, "progress")).toBe(1);
    expect(selection[0]!.issues).toHaveLength(5);
  });
  it("intersects global/repository filters for both points and calibration and honors repository rules", () => {
    const data = [issue(10, 3, { title: "Selected UI" }), issue(11, 5, { title: "Selected API", labels: [{ name: "Doing", color: "" }, { name: "points: 5", color: "" }] }), ...history()];
    const selection = overviewEstimateGroups([lane(data)], { "a/b": { progress: "Doing" } }, true, { query: "Selected", repositoryQueries: { "a/b": "API" } });
    expect(overviewPoints(selection, "open")).toBe(5);
    expect(overviewPoints(selection, "progress")).toBe(5);
    expect(overviewTimeEstimate(selection, "open", now).remainingMs).toBeNull();
  });
});
describe("overview time model", () => {
  it("uses the backlog horizon for all open work and the maximum across parallel repositories", () => {
    const selection = groups([lane([...history(), issue(10), progress(11)]), lane([...history(40 * minute), progress(11)], "a/c")]);
    expect(overviewTimeEstimate(selection, "open", now)).toMatchObject({ repositories: 2, knownRepositories: 2, remainingMs: 50 * minute });
    expect(overviewTimeEstimate(selection, "progress", now)).toMatchObject({ repositories: 2, knownRepositories: 2, remainingMs: 30 * minute });
    expect(overviewTimeEstimate(selection, "open", now + 5 * minute).remainingMs).toBe(45 * minute);
  });
  it("reports partial coverage for only repositories containing the selected work", () => {
    const selection = groups([lane([...history(), progress(10)]), lane([issue(10, 8)], "a/c"), lane(history(), "a/d")]);
    expect(overviewPoints(selection, "open")).toBe(9);
    expect(overviewTimeEstimate(selection, "open", now)).toMatchObject({ repositories: 2, knownRepositories: 1, remainingMs: 20 * minute });
    expect(overviewTimeEstimate(selection, "progress", now)).toMatchObject({ repositories: 1, knownRepositories: 1 });
  });
  it("preserves measured zero, overdue and full duration for unknown/future starts", () => {
    const overdue = groups([lane([...history(), progress(10, 40 * minute)])]);
    expect(overviewTimeEstimate(overdue, "progress", now)).toMatchObject({ remainingMs: 0, overdue: 1, counting: false });
    for (const startedAt of [null, "invalid", iso(now + minute)]) {
      const unknown = groups([lane([...history(), { ...progress(10), startedAt }])]);
      expect(overviewTimeEstimate(unknown, "progress", now)).toMatchObject({ remainingMs: 30 * minute, unknownStart: 1, counting: false });
    }
  });
  it("exposes the future start boundary so an isolated clock can begin counting then", () => {
    const selection = groups([lane([...history(), { ...progress(10), startedAt: iso(now + minute) }])]);
    expect(overviewTimeEstimate(selection, "progress", now)).toMatchObject({ nextStartMs: now + minute, counting: false });
    expect(overviewTimeEstimate(selection, "progress", now + 2 * minute)).toMatchObject({ remainingMs: 29 * minute, counting: true, unknownStart: 0, nextStartMs: Infinity });
  });
  it("omits time with no eligible history and treats an empty selection as zero points", () => {
    const empty = groups([lane(history())]);
    expect(overviewPoints(empty, "open")).toBe(0);
    expect(overviewTimeEstimate(empty, "open", now)).toMatchObject({ remainingMs: null, repositories: 0 });
    expect(overviewTimeEstimate(groups([lane([progress(10)])]), "progress", now).remainingMs).toBeNull();
    expect(overviewTimeEstimate(groups([lane([...history(), issue(10)])]), "open", now + 31 * day).remainingMs).toBeNull();
  });
});
