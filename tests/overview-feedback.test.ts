import { describe, expect, it } from "vitest";
import { countClosedToday, emptyCounts, OverviewFeedbackTracker, summarizeOverviewSecondary } from "../src/lib/overview-feedback";
import { countActiveRepositories, isInactiveRepository, summarizeLanes } from "../src/lib/sidebar";
import type { Issue, Lane, Rules } from "../src/lib/model";
const issue = (id: number, labels: string[] = [], state = "open", closedAt: string | null = null): Issue => ({
  id, number: id, title: "Task", labels: labels.map(name => ({ name, color: "000000" })), state,
  closed_at: closedAt, created_at: "2026-10-15", updated_at: "2026-10-16", html_url: "https://github.com/a/b/issues/1", assignees: [],
});
const lane = (issues: Issue[], repo = "a/b", error?: string): Lane => ({
  repo: { id: 1, name: "b", full_name: repo, description: null, private: false, html_url: "https://github.com/a/b", owner: { login: "a" } }, issues, labels: [], error,
});
const update = (tracker: OverviewFeedbackTracker, lanes: Lane[], options: { rules?: Record<string, Rules>; hide?: boolean; live?: boolean; session?: number } = {}) => tracker.update(lanes, options.rules || {}, options.hide || false, options.live ?? true, options.session ?? 1);
describe("overview change feedback", () => {
  it("tracks filtered changes even when hidden issues cancel their raw totals", () => {
    const tracker = new OverviewFeedbackTracker();
    const visible = { ...issue(1, ["in-progress"]), title: "Visible work" };
    const hidden = { ...issue(2, [], "closed"), title: "Hidden work" };
    const first = [lane([visible, hidden])];
    const changed = [lane([{ ...visible, state: "closed" }, { ...hidden, state: "open", labels: [{ name: "in-progress", color: "fff" }] }])];
    const filters = { query: "Visible" };
    expect(tracker.update(first, {}, false, true, 1, filters)).toEqual(emptyCounts());
    expect(tracker.update(changed, {}, false, true, 1, filters)).toEqual({ open: -1, progress: -1, closed: 1 });
    expect(tracker.progressOutcome).toBe("positive");
    expect(tracker.update(changed, {}, false, true, 1, {})).toEqual(emptyCounts());
    expect(tracker.update(changed, {}, false, true, 1, { repositoryQueries: { "a/b": "Visible" } })).toEqual(emptyCounts());
    expect(tracker.update(first, {}, false, true, 1, { repositoryQueries: { "a/b": "Visible" } })).toEqual({ open: 1, progress: 1, closed: -1 });
  });
  it("marks the same progress decrease positive for completion and negative for backlog", () => {
    const tracker = new OverviewFeedbackTracker();
    update(tracker, [lane([issue(1, ["in-progress"])])]);
    expect(update(tracker, [lane([issue(1, [], "closed")])]).progress).toBe(-1);
    expect(tracker.progressOutcome).toBe("positive");
    expect(update(tracker, [lane([issue(1, [], "closed")])])).toEqual(emptyCounts());
    expect(tracker.progressOutcome).toBeNull();
    update(tracker, [lane([issue(1, ["in-progress"])])]);
    expect(update(tracker, [lane([issue(1)])]).progress).toBe(-1);
    expect(tracker.progressOutcome).toBe("negative");
  });
  it.each([false, true])("gives backlog precedence over simultaneous completed work regardless of repository order (%s)", reverse => {
    const tracker = new OverviewFeedbackTracker();
    const initial = [lane([issue(1, ["in-progress"])]), lane([issue(1, ["in-progress"])], "a/c")];
    const next = [lane([issue(1, [], "closed")]), lane([issue(1)], "a/c")];
    update(tracker, reverse ? initial.reverse() : initial);
    expect(update(tracker, reverse ? next.reverse() : next).progress).toBe(-2);
    expect(tracker.progressOutcome).toBe("negative");
  });
  it("silently rebaselines outcomes for rule/view/session edits and ignores failed or missing destinations", () => {
    const tracker = new OverviewFeedbackTracker();
    const initial = [lane([issue(1, ["in-progress"])])];
    update(tracker, initial);
    update(tracker, [lane([issue(1)])], { rules: { "a/b": { progress: "custom" } } });
    expect(tracker.progressOutcome).toBeNull();
    update(tracker, initial);
    update(tracker, [lane([issue(1, [], "closed")], "a/b", "failed")]);
    expect(tracker.progressOutcome).toBeNull();
    update(tracker, [lane([issue(1, [], "closed")])]);
    expect(tracker.progressOutcome).toBe("positive");
    update(tracker, initial);
    update(tracker, [lane([])]);
    expect(tracker.progressOutcome).toBeNull();
    update(tracker, initial);
    update(tracker, [lane([issue(1)])], { hide: true });
    expect(tracker.progressOutcome).toBeNull();
    update(tracker, initial);
    update(tracker, [lane([issue(1, [], "closed")])], { session: 2 });
    expect(tracker.progressOutcome).toBeNull();
  });
  it("is silent on startup/cache, returns simultaneous signed deltas, and ignores unchanged snapshots", () => {
    const tracker = new OverviewFeedbackTracker();
    const first = [lane([issue(1), issue(2, ["in-progress"]), issue(3)])];
    expect(update(tracker, first, { live: false })).toEqual(emptyCounts());
    expect(update(tracker, first)).toEqual(emptyCounts());
    const next = [lane([issue(1, ["in-progress"]), issue(2, [], "closed"), issue(3, [], "closed")])];
    expect(update(tracker, next)).toEqual({ open: -2, progress: 0, closed: 2 });
    expect(update(tracker, next)).toEqual(emptyCounts());
    expect(update(tracker, first)).toEqual({ open: 2, progress: 0, closed: -2 });
  });
  it("does not read text filters; honors rules and silently rebaselines view/session changes", () => {
    const tracker = new OverviewFeedbackTracker();
    const lanes = [lane([issue(1, ["working-custom"]), issue(2, ["orkester"])])];
    update(tracker, lanes);
    expect(update(tracker, lanes, { rules: { "a/b": { progress: "working-custom" } } })).toEqual(emptyCounts());
    expect(update(tracker, [lane([issue(1, [], "closed"), issue(2, ["orkester"])])], { rules: { "a/b": { progress: "working-custom" } } })).toEqual({ open: -1, progress: -1, closed: 1 });
    expect(update(tracker, lanes, { hide: true })).toEqual(emptyCounts());
    expect(update(tracker, [lane([], "a/c")])).toEqual(emptyCounts());
    expect(update(tracker, lanes, { session: 2 })).toEqual(emptyCounts());
  });
  it("retains baseline through errors and treats first recovered snapshot as baseline if never loaded", () => {
    const tracker = new OverviewFeedbackTracker();
    update(tracker, [lane([issue(1)]), lane([], "a/c", "failed")]);
    expect(update(tracker, [lane([], "a/b", "failed"), lane([issue(2)], "a/c")])).toEqual(emptyCounts());
    expect(update(tracker, [lane([issue(1, ["in-progress"])]), lane([issue(2)], "a/c")])).toEqual({ open: 0, progress: 1, closed: 0 });
    tracker.clear();
    expect(update(tracker, [lane([issue(1)])])).toEqual(emptyCounts());
  });
  it("deduplicates loaded issues and excludes pull requests and hidden coordination", () => {
    const tracker = new OverviewFeedbackTracker();
    update(tracker, [lane([])], { hide: true });
    const pr = { ...issue(1), pull_request: {} };
    expect(update(tracker, [lane([pr, issue(2), issue(2), issue(3, ["orkester"])])], { hide: true })).toEqual({ open: 1, progress: 0, closed: 0 });
  });
});
describe("current issues closed today", () => {
  it("uses local calendar dates and deduplicates per repo while excluding future/reopened/PR/coordination", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const today = new Date(2026, 9, 16, 0, 1).toISOString();
    const yesterday = new Date(2026, 9, 15, 23, 59).toISOString();
    const tomorrow = new Date(2026, 9, 17, 0, 1).toISOString();
    const lanes = [lane([issue(1, [], "closed", today), issue(1, [], "closed", today), issue(2, [], "closed", yesterday), issue(3, [], "closed", tomorrow), issue(4, [], "open", today), { ...issue(5, [], "closed", today), pull_request: {} }, issue(6, ["orkester"], "closed", today), issue(7, [], "closed", "bad")]), lane([issue(1, [], "closed", today)], "a/c")];
    expect(countClosedToday(lanes, now)).toBe(3);
    expect(countClosedToday(lanes, now, true)).toBe(2);
    expect(countClosedToday(lanes, new Date(2026, 9, 17, 1).getTime(), true)).toBe(1);
  });
});


describe("shared active repository classification", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const recent = new Date(now - 86400000).toISOString();
  const active = (lanes: Lane[], rules: Record<string, Rules> = {}, hide = true) => {
    const repositories = summarizeLanes(lanes, rules, hide);
    const count = countActiveRepositories(repositories);
    expect(summarizeOverviewSecondary(lanes, rules, now, hide, { query: "no match", repositoryQueries: { "a/b": "also no match" } }, repositories).activeRepositories).toBe(count);
    expect(repositories.filter(repo => !isInactiveRepository(repo))).toHaveLength(count);
    return count;
  };
  it("counts one active repository beside empty and closed-only repositories", () => {
    expect(active([lane([issue(1)]), lane([], "a/empty"), lane([issue(2, [], "closed", recent)], "a/closed")])).toBe(1);
    expect(active([lane([issue(1, ["in-progress"])])])).toBe(1);
    expect(active([lane([issue(1, ["in-progress"], "closed", recent)])])).toBe(0);
  });
  it("keeps loading repositories active until their empty or closed-only snapshot resolves", () => {
    const loading = { ...lane([]), loading: true };
    expect(active([loading])).toBe(1);
    expect(active([{ ...loading, issues: [issue(1, [], "closed", recent)] }])).toBe(1);
    expect(active([{ ...loading, loading: false, issues: [issue(1, [], "closed", recent)] }])).toBe(0);
    expect(active([{ ...loading, loading: false }])).toBe(0);
    expect(active([{ ...loading, loading: false, error: "unavailable" }])).toBe(0);
  });
  it("reacts to backlog, custom work labels, closing and reopening with stale work labels", () => {
    const rules = { "a/b": { progress: "building" } };
    expect(active([lane([issue(1)])], rules)).toBe(1);
    expect(active([lane([issue(1, ["building"])])], rules)).toBe(1);
    expect(active([lane([issue(1, ["building"], "closed", recent)])], rules)).toBe(0);
    expect(active([lane([issue(1, ["building"], "open", recent)])], rules)).toBe(1);
  });
  it("respects coordination visibility and excludes pull requests", () => {
    const lanes = [lane([issue(1, ["building", "orkester"])]), lane([{ ...issue(2), pull_request: {} }], "a/pr")];
    expect(active(lanes, { "a/b": { progress: "building" } })).toBe(0);
    expect(active(lanes, { "a/b": { progress: "building" } }, false)).toBe(1);
  });
  it("deduplicates repository identities", () => {
    const loaded = lane([issue(1)]);
    expect(countActiveRepositories(summarizeLanes([loaded, loaded, lane([], "a/empty")], {}, true))).toBe(1);
  });
});

describe("secondary overview summary counts (#152)", () => {
  const now = new Date(2026, 9, 16, 12).getTime();
  const today = new Date(2026, 9, 16, 9).toISOString();
  const fiveDaysAgo = new Date(now - 5 * 86400000).toISOString();
  const tenDaysAgo = new Date(now - 10 * 86400000).toISOString();
  it("computes secondary cell counts across repositories, open/backlog, in-progress and closed cards", () => {
    const lanes = [
      lane([
        { ...issue(1, ["priority: high"]), title: "Match backlog" },
        { ...issue(2, ["in-progress", "priority: high"]), title: "Match progress" },
        issue(3, [], "closed", today),
        issue(4, [], "closed", tenDaysAgo),
      ], "a/one"),
      lane([
        { ...issue(5, ["priority: low"]), title: "Other backlog" },
        { ...issue(6, ["in-progress"]), title: "Other progress" },
        issue(7, [], "closed", fiveDaysAgo),
        issue(8, ["orkester"]),
      ], "a/two"),
    ];
    expect(summarizeOverviewSecondary(lanes, {}, now, true)).toEqual({
      activeRepositories: 2,
      backlogRepositories: 2,
      backlogIssues: 2,
      highPriorityOpen: 2,
      progressRepositories: 2,
      highPriorityProgress: 1,
      closedToday: 1,
      closedLast7Days: 2,
    });
    // Text filters narrow open and in-progress breakdowns while keeping repository and closed-window counts stable.
    expect(summarizeOverviewSecondary(lanes, {}, now, true, { query: "Match" })).toEqual({
      activeRepositories: 2,
      backlogRepositories: 2,
      backlogIssues: 1,
      highPriorityOpen: 2,
      progressRepositories: 1,
      highPriorityProgress: 1,
      closedToday: 1,
      closedLast7Days: 2,
    });
  });
});
