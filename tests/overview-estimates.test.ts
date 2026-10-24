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

it("keeps the overview horizon calibrated to normal work despite an interrupted closure", () => {
  const samples = [20, 30, 40, 450].map((minutes, index) => issue(index + 1, 1, {
    state: "closed", closed_at: iso(now - day), workStartedAt: iso(now - day - minutes * minute),
  }));
  const selection = groups([lane([...samples, progress(10)])]);
  expect(overviewTimeEstimate(selection, "progress", now)).toMatchObject({ remainingMs: 20 * minute, knownRepositories: 1 });
});

it("deducts sub-issue time from the parent in the overview badge without counting the child twice (#279)", () => {
  const parent = issue(20, 3), child = progress(21, 20 * minute);
  const selection = groups([lane([...history(), parent, child])]);
  expect(overviewTimeEstimate(selection, "progress", now)).toMatchObject({ remainingMs: 10 * minute });
  const children = new Map([[parent.id, [{ issue: child }]]]);
  expect(overviewTimeEstimate(selection, "progress", now, children)).toMatchObject({ remainingMs: 70 * minute, counting: true });
  expect(overviewTimeEstimate(selection, "open", now, children)).toMatchObject({ remainingMs: 70 * minute });
});

it("groups story points like the time: absorbed sub-issues once, the group in the column its time is in (#281)", () => {
  const parent = issue(20, 3), child = progress(21, 20 * minute), other = progress(22), waiting = issue(23, 2);
  const selection = groups([lane([...history(), parent, child, other, waiting])]);
  expect(overviewPoints(selection, "progress")).toBe(2);
  expect(overviewPoints(selection, "open")).toBe(7);
  const children = new Map([[parent.id, [{ issue: child }]]]);
  // The Backlog parent's group runs, so In progress shows its 3 points instead of the child's 1.
  expect(overviewPoints(selection, "progress", children, now)).toBe(4);
  expect(overviewPoints(selection, "open", children, now)).toBe(6);
  // A group whose sub-issue only closed stays in the Backlog; open work counts it once.
  const closedChild = issue(24, 1, { state: "closed", closed_at: iso(now - minute), workStartedAt: iso(now - 30 * minute) });
  const idle = groups([lane([...history(), parent, closedChild, other])]);
  expect(overviewPoints(idle, "progress", new Map([[parent.id, [{ issue: closedChild }]]]), now)).toBe(1);
  expect(overviewPoints(idle, "open", new Map([[parent.id, [{ issue: closedChild }]]]), now)).toBe(4);
  // Without calibration there is no grouped time, so points stay per issue.
  const uncalibrated = groups([lane([parent, child])]);
  expect(overviewPoints(uncalibrated, "progress", children, now)).toBe(1);
  expect(overviewPoints(uncalibrated, "open", children, now)).toBe(4);
});

it("counts a sub-issue once across repositories and keeps unknown-start texts consistent (#287)", () => {
  const parent = progress(30, 60 * minute), middle = progress(31, 20 * minute), grandchild = progress(32, 10 * minute);
  const children = new Map([[parent.id, [{ issue: middle }]], [middle.id, [{ issue: grandchild }]]]);
  const selection = groups([lane([...history(), parent, grandchild]), lane([...history(), middle], "a/c")]);
  // Each repository counts its own items: a/b the parent and the grandchild, a/c the middle issue.
  expect(overviewPoints(selection, "progress", children, now)).toBe(3);
  // a/b: parent 30 − 60 min overdue, grandchild 30 − 10 min; a/c: 30 − 20 min. Nothing is deducted twice.
  expect(overviewTimeEstimate(selection, "progress", now, children)).toMatchObject({ remainingMs: 20 * minute, overdue: 1 });
  // A future-start parent whose sub-issue time already exceeds its estimate is overdue, not "full time".
  const future = { ...progress(40), startedAt: new Date(now + minute).toISOString() };
  const closed = issue(41, 1, { state: "closed", closed_at: new Date(now - minute).toISOString(), workStartedAt: new Date(now - 41 * minute).toISOString() });
  const late = overviewTimeEstimate(groups([lane([...history(), future])]), "progress", now, new Map([[future.id, [{ issue: closed }]]]));
  expect(late).toMatchObject({ remainingMs: 0, overdue: 1, unknownStart: 0 });
});

import { overviewClosedSummary, overviewRepositoryInfo } from "../src/lib/overview-estimates";
describe("overview closed and repository details (#291)", () => {
  const closed = (id: number, points: number, duration?: number, extra: Partial<Issue> = {}) => issue(id, points, { state: "closed", closed_at: iso(now - day), ...(duration ? { workStartedAt: iso(now - day - duration) } : {}), ...extra });
  it("sums points of closed issues and takes the median of known durations", () => {
    const selection = groups([lane([closed(1, 3, 10 * minute), closed(2, 5, 30 * minute), closed(3, 2), issue(4, 8)])]);
    expect(overviewClosedSummary(selection, now)).toMatchObject({ points: 10, medianMs: 20 * minute, measured: 2 });
  });
  it("hides the median without known durations and keeps a measured zero", () => {
    expect(overviewClosedSummary(groups([lane([closed(1, 2)])]), now)).toMatchObject({ points: 2, medianMs: null });
    expect(overviewClosedSummary(groups([lane([issue(4, 8)])]), now)).toMatchObject({ points: 0, medianMs: null });
  });
  it("follows coordination and text filters", () => {
    const data = [closed(1, 3, 10 * minute, { title: "Keep" }), closed(2, 5, 30 * minute, { labels: [{ name: "orkester", color: "" }] }), closed(3, 8, undefined, { title: "Other" })];
    expect(overviewClosedSummary(groups([lane(data)]), now).points).toBe(11);
    expect(overviewClosedSummary(overviewEstimateGroups([lane(data)], {}, true, { query: "Keep" }), now)).toMatchObject({ points: 3, medianMs: 10 * minute });
  });
  it("counts visibility and owners once per repository", () => {
    const pub = lane([], "x/y"); pub.repo = { ...pub.repo, private: false, owner: { login: "x" } };
    expect(overviewRepositoryInfo([lane([]), lane([]), pub])).toEqual({ private: 1, public: 1, owners: 2 });
    expect(overviewRepositoryInfo([])).toEqual({ private: 0, public: 0, owners: 0 });
  });
});
