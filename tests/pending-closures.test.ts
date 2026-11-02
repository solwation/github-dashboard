import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue, Lane } from "../src/lib/model";
import { column } from "../src/lib/model";
import {
  PENDING_CLOSURE_TTL_MS,
  PendingClosures,
  departedIssues,
  mergeVerified,
  pendingIssue,
  verificationAllowed,
  verificationOutcome,
  withPendingClosures,
  type PendingClosure,
  type Verification,
} from "../src/lib/pending-closures";

const NOW = Date.parse("2026-11-02T10:00:00Z");
const repo = { id: 1, name: "alpha", full_name: "sample/alpha", description: null, private: false, html_url: "https://github.com/sample/alpha", owner: { login: "sample" } };
const progressLabel = { name: "in progress", color: "fbca04" };
function issue(id: number, overrides: Partial<Issue> = {}): Issue {
  return {
    id, number: id, title: `Issue ${id}`, html_url: `https://github.com/sample/alpha/issues/${id}`, state: "open",
    created_at: "2026-10-01T00:00:00Z", updated_at: "2026-11-02T09:00:00Z", closed_at: null, labels: [], assignees: [], ...overrides,
  };
}
const working = (id: number) => issue(id, { labels: [progressLabel], startedAt: "2026-11-02T08:00:00Z", timerError: false });
const lane = (issues: Issue[], extra: Partial<Lane> = {}): Lane => ({ repo, labels: [], issues, ...extra });

describe("departedIssues", () => {
  it("finds in-progress and just-closed issues missing from the next snapshot", () => {
    const closedRecently = issue(2, { state: "closed", closed_at: new Date(NOW - 60_000).toISOString() });
    const closedLongAgo = issue(3, { state: "closed", closed_at: "2026-10-20T00:00:00Z" });
    const backlog = issue(4);
    const previous = lane([working(1), closedRecently, closedLongAgo, backlog, working(5)]);
    const next = lane([working(5)]);
    expect(departedIssues(previous, next, {}, NOW).map(i => i.id)).toEqual([1, 2]);
  });
  it("ignores loading or failed lanes, pull requests and unchanged lanes", () => {
    const previous = lane([working(1), { ...working(2), pull_request: {} }]);
    expect(departedIssues(previous, lane([], { error: "boom" }), {}, NOW)).toEqual([]);
    expect(departedIssues({ ...previous, loading: true }, lane([]), {}, NOW)).toEqual([]);
    expect(departedIssues(undefined, lane([]), {}, NOW)).toEqual([]);
    expect(departedIssues(previous, previous, {}, NOW)).toEqual([]);
    expect(departedIssues(previous, lane([]), {}, NOW).map(i => i.id)).toEqual([1]);
  });
  it("uses the repository's own progress rule", () => {
    const custom = issue(1, { labels: [{ name: "Doing now", color: "000000" }] });
    expect(departedIssues(lane([custom]), lane([]), {}, NOW)).toEqual([]);
    expect(departedIssues(lane([custom]), lane([]), { progress: "Doing now" }, NOW)).toHaveLength(1);
  });
});

describe("pending representation", () => {
  const entry = (i: Issue): PendingClosure => ({ repository: "sample/alpha", issue: i, detectedAt: NOW, deadline: NOW + 1, failures: 0, nextAttemptAt: NOW });
  it("shows a left in-progress issue as a pending closed card without a running timer", () => {
    const shown = pendingIssue(entry(working(1)));
    expect(shown).toMatchObject({ state: "closed", closed_at: new Date(NOW).toISOString(), pendingClosure: true, workStartedAt: "2026-11-02T08:00:00Z" });
    expect(shown).not.toHaveProperty("startedAt");
    expect(column(shown)).toBe("closed");
  });
  it("keeps the known closing time of an already closed issue", () => {
    const closed = issue(2, { state: "closed", closed_at: "2026-11-02T09:59:00Z" });
    expect(pendingIssue(entry(closed)).closed_at).toBe("2026-11-02T09:59:00Z");
  });
  it("overlays pending cards without mutating lanes and keeps untouched lanes by identity", () => {
    const shown = lane([issue(9)]);
    const other: Lane = { ...lane([]), repo: { ...repo, id: 2, full_name: "sample/beta" } };
    const lanes = [shown, other];
    const result = withPendingClosures(lanes, [entry(working(1))]);
    expect(result[0]!.issues.map(i => [i.id, !!i.pendingClosure])).toEqual([[9, false], [1, true]]);
    expect(result[1]).toBe(other);
    expect(shown.issues).toHaveLength(1);
    expect(withPendingClosures(lanes, [])).toBe(lanes);
    // An issue the lane contains again needs no pending duplicate.
    expect(withPendingClosures([lane([working(1)])], [entry(working(1))])[0]!.issues).toHaveLength(1);
  });
});

describe("verification", () => {
  const entry: PendingClosure = { repository: "sample/alpha", issue: working(1), detectedAt: NOW, deadline: NOW + 1, failures: 0, nextAttemptAt: NOW };
  it("merges a response for the same issue and removes deleted, transferred or unrelated ones", () => {
    expect(verificationOutcome(entry, { kind: "issue", issue: issue(1, { state: "closed" }) })).toBe("merge");
    expect(verificationOutcome(entry, { kind: "issue", issue: issue(1) })).toBe("merge");
    expect(verificationOutcome(entry, { kind: "gone" })).toBe("remove");
    expect(verificationOutcome(entry, { kind: "issue", issue: issue(1, { html_url: "https://github.com/other/repo/issues/7" }) })).toBe("remove");
    expect(verificationOutcome(entry, { kind: "issue", issue: issue(2) })).toBe("remove");
    expect(verificationOutcome(entry, { kind: "error" })).toBe("retry");
  });
  it("merges verified issues into the lane, never over a newer copy", () => {
    const closed = issue(1, { state: "closed", closed_at: new Date(NOW - 5000).toISOString(), updated_at: "2026-11-02T09:59:55Z" });
    const merged = mergeVerified(lane([issue(9)]), closed, {}, NOW);
    expect(merged.issues.map(i => i.id)).toEqual([9, 1]);
    const newer = lane([issue(1, { updated_at: "2026-11-02T10:00:30Z" })]);
    expect(mergeVerified(newer, closed, {}, NOW)).toBe(newer);
    const reopened = mergeVerified(lane([working(1)]), working(1), {}, NOW);
    expect(column(reopened.issues[0]!)).toBe("progress");
  });
  it("respects Retry-After, low quota and offline state", () => {
    expect(verificationAllowed({ retryAfterMs: 0, remainingQuota: 500 })).toBe(true);
    expect(verificationAllowed({ retryAfterMs: 0, remainingQuota: null })).toBe(true);
    expect(verificationAllowed({ retryAfterMs: 1000, remainingQuota: 500 })).toBe(false);
    expect(verificationAllowed({ retryAfterMs: 0, remainingQuota: 10 })).toBe(false);
    expect(verificationAllowed({ retryAfterMs: 0, online: false })).toBe(false);
  });
});

describe("PendingClosures", () => {
  let now = NOW;
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); now = NOW; });
  afterEach(() => vi.useRealTimers());
  function setup(verify: (issue: Issue) => Promise<Verification> | Verification, canRequest = () => true) {
    const applied: Issue[] = [], reconciled: string[] = [], changes: number[] = [];
    let entries: readonly PendingClosure[] = [];
    const calls = vi.fn(async (_repository: string, i: Issue) => verify(i));
    const tracker = new PendingClosures({
      verify: calls, canRequest, now: () => now,
      apply: (_repository, i) => applied.push(i),
      reconcile: name => reconciled.push(name),
      onChange: list => { entries = list; changes.push(list.length); },
    });
    return { tracker, applied, reconciled, changes, calls, entries: () => entries };
  }
  const advance = async (ms: number) => { now += ms; await vi.advanceTimersByTimeAsync(ms); };

  it("keeps a departed issue pending, verifies it at once and confirms the closing", async () => {
    const closed = issue(1, { state: "closed", closed_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString() });
    let resolve!: (value: Verification) => void;
    const t = setup(() => new Promise(r => { resolve = r; }));
    t.tracker.observe(lane([working(1)]), lane([]));
    expect(t.entries().map(e => e.issue.id)).toEqual([1]);
    expect(t.calls).toHaveBeenCalledTimes(1);
    resolve({ kind: "issue", issue: closed });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.applied).toEqual([closed]);
    expect(t.entries()).toEqual([]);
  });

  it("restores an issue that was not closed and removes a deleted one", async () => {
    const t = setup(i => i.id === 1 ? { kind: "issue", issue: issue(1) } : { kind: "gone" });
    t.tracker.observe(lane([working(1), working(2)]), lane([]));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.applied.map(i => [i.id, column(i)])).toEqual([[1, "backlog"]]);
    expect(t.entries()).toEqual([]);
  });

  it("settles a pending issue that a later sync contains again, without duplicates", async () => {
    const t = setup(() => new Promise(() => {}));
    t.tracker.observe(lane([working(1)]), lane([]));
    t.tracker.observe(lane([working(1)]), lane([working(1)]));
    expect(t.entries()).toEqual([]);
    // Detecting the same departure twice keeps one entry and one request.
    t.tracker.observe(lane([working(1)]), lane([]));
    t.tracker.observe(lane([working(1)]), lane([]));
    expect(t.entries()).toHaveLength(1);
    expect(t.calls).toHaveBeenCalledTimes(2);
  });

  it("retries failed verification with backoff and expires into a final reconciliation", async () => {
    const t = setup(() => ({ kind: "error" }));
    t.tracker.observe(lane([working(1)]), lane([]));
    await advance(0);
    expect(t.calls).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(t.calls).toHaveBeenCalledTimes(2);
    await advance(10_000);
    expect(t.calls).toHaveBeenCalledTimes(3);
    await advance(PENDING_CLOSURE_TTL_MS);
    expect(t.entries()).toEqual([]);
    expect(t.reconciled).toEqual(["sample/alpha"]);
    // The same unverifiable snapshot is not made pending again after it expired.
    t.tracker.observe(lane([working(1)]), lane([]));
    expect(t.entries()).toEqual([]);
  });

  it("does not request while GitHub asks to wait, but still expires on time", async () => {
    let allowed = false;
    const t = setup(() => ({ kind: "issue", issue: issue(1, { state: "closed", closed_at: new Date(NOW).toISOString() }) }), () => allowed);
    t.tracker.observe(lane([working(1)]), lane([]));
    await advance(30_000);
    expect(t.calls).not.toHaveBeenCalled();
    expect(t.entries()).toHaveLength(1);
    allowed = true;
    await advance(5_000);
    expect(t.calls).toHaveBeenCalledTimes(1);
    expect(t.entries()).toEqual([]);
  });

  it("drops entries for removed repositories and ignores late answers after clear", async () => {
    let resolve!: (value: Verification) => void;
    const t = setup(() => new Promise(r => { resolve = r; }));
    t.tracker.observe(lane([working(1)]), lane([]));
    t.tracker.retain(["sample/beta"]);
    expect(t.entries()).toEqual([]);
    t.tracker.observe(lane([working(2)]), lane([]));
    t.tracker.clear();
    resolve({ kind: "issue", issue: issue(2, { state: "closed" }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.applied).toEqual([]);
    expect(t.entries()).toEqual([]);
  });
});
