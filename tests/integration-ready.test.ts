import { describe, expect, it } from "vitest";
import {
  activeWorkMs, activeWorkStart, awaitsIntegration, carriedWork, closedWorkMs, closedWorkPeriod, column, deriveWorkStarts,
  hidesWorkLabel, isActiveWork, isIntegrationReady, progressPeriod, progressStart, WORK_HANDOFF_GRACE_MS,
  type Event, type Issue, type Lane,
} from "../src/lib/model";
import { closedIssueOutcome, historySamples, issueEstimate, issueGroupEstimate, parallelism, repositoryEstimate } from "../src/lib/estimates";
import { nextTimeout, TimeoutTracker } from "../src/lib/timeouts";
import { inactiveWork } from "../src/lib/work-activity";
import { repositoryActivity } from "../src/lib/repository-activity";

const min = 60_000, hour = 60 * min;
const t0 = Date.parse("2026-11-04T08:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const at = (minutes: number) => iso(t0 + minutes * min);
let eventId = 0;
const ev = (event: string, minutes: number, label?: string): Event => ({ id: ++eventId, event, created_at: at(minutes), ...(label ? { label: { name: label } } : {}) });
const add = (minutes: number, label: string) => ev("labeled", minutes, label);
const remove = (minutes: number, label: string) => ev("unlabeled", minutes, label);
function issue(labels: string[], extra: Partial<Issue> = {}): Issue {
  return { id: 1, number: 1, title: "Fixture", html_url: "", state: "open", created_at: at(-600), updated_at: at(0), closed_at: null,
    labels: labels.map(name => ({ name, color: "" })), assignees: [], ...extra };
}

describe("integration-ready detection (#392)", () => {
  it("recognizes normalized integration-ready labels as a distinct waiting status", () => {
    for (const name of ["integration-ready", "integration_ready", "Integration Ready", " INTEGRATION:READY "]) expect(isIntegrationReady(name)).toBe(true);
    for (const name of ["integration", "ready", "integration-ready-later", "in-progress"]) expect(isIntegrationReady(name)).toBe(false);
    const waiting = issue(["integration-ready", "orkester: session"]);
    expect(column(waiting)).toBe("progress");
    expect(awaitsIntegration(waiting)).toBe(true);
    expect(isActiveWork(waiting)).toBe(false);
  });
  it("keeps closed issues closed and owner labels as ownership only", () => {
    expect(column(issue(["integration-ready"], { state: "closed", closed_at: at(5) }))).toBe("closed");
    expect(awaitsIntegration(issue(["integration-ready"], { state: "closed", closed_at: at(5) }))).toBe(false);
    expect(column(issue(["orkester: session"]))).toBe("backlog");
  });
  it("lets active work win when both labels are present", () => {
    const both = issue(["integration-ready", "in-progress"]);
    expect(column(both)).toBe("progress");
    expect(isActiveWork(both)).toBe(true);
    expect(awaitsIntegration(both)).toBe(false);
  });
  it("stays recognized when a custom work label replaces the default work labels", () => {
    const rules = { progress: "Doing now" };
    expect(column(issue(["integration-ready"]), rules)).toBe("progress");
    expect(column(issue(["in-progress"]), rules)).toBe("backlog");
    expect(isActiveWork(issue(["integration-ready", "doing now"]), rules)).toBe(true);
    expect(awaitsIntegration(issue(["integration-ready", "in-progress"]), rules)).toBe(true);
  });
  it("hides work label chips where the column or indicator already shows them", () => {
    expect(hidesWorkLabel("progress", "integration-ready")).toBe(true);
    expect(hidesWorkLabel("closed", "integration_ready")).toBe(true);
    expect(hidesWorkLabel("backlog", "integration-ready")).toBe(false);
    expect(hidesWorkLabel("progress", "orkester: session")).toBe(false);
  });
});

describe("In progress periods with integration waits (#392)", () => {
  // implementation → integration-ready (one edit) → active integration → closed
  const lifecycle = () => [
    add(0, "in-progress"),
    remove(60, "in-progress"), add(60, "integration-ready"),
    remove(100, "integration-ready"), add(100, "in-progress"),
    ev("closed", 130), remove(130, "in-progress"),
  ];
  it("keeps the start through the handoff and separates the wait", () => {
    const events = lifecycle();
    expect(progressPeriod(events.slice(0, 1))).toEqual({ start: at(0), waitMs: 0, waitingSince: null });
    expect(progressPeriod(events.slice(0, 3))).toEqual({ start: at(0), waitMs: 0, waitingSince: at(60) });
    expect(progressPeriod(events.slice(0, 5))).toEqual({ start: at(0), waitMs: 40 * min, waitingSince: null });
    expect(progressStart(events)).toBeNull();
    expect(closedWorkPeriod(events, at(130))).toEqual({ start: at(0), waitMs: 40 * min });
  });
  it("continues the period across a handoff made as two separate edits, but not after a real pause", () => {
    const quick = [add(0, "in-progress"), remove(60, "in-progress"), add(62, "integration-ready")];
    expect(progressPeriod(quick)).toEqual({ start: at(0), waitMs: 0, waitingSince: at(62) });
    const resumed = [...quick, remove(90, "integration-ready"), add(91, "in-progress")];
    expect(progressPeriod(resumed)).toEqual({ start: at(0), waitMs: 28 * min, waitingSince: null });
    const paused = [add(0, "in-progress"), remove(60, "in-progress"), add(60 + WORK_HANDOFF_GRACE_MS / min + 1, "integration-ready")];
    expect(progressPeriod(paused).start).toBe(at(66));
    // Plain active labels keep the original rule: a removed and re-added work label starts again.
    expect(progressStart([add(0, "in-progress"), remove(10, "in-progress"), add(11, "in-progress")])).toBe(at(11));
    expect(progressStart([add(0, "in-progress"), add(5, "wip"), remove(10, "in-progress")])).toBe(at(5));
  });
  it("handles both labels at once, corrections, pauses and reopening", () => {
    // Adding integration-ready before removing in-progress: no wait while both are present.
    const overlap = [add(0, "in-progress"), add(50, "integration-ready"), remove(60, "in-progress")];
    expect(progressPeriod(overlap)).toEqual({ start: at(0), waitMs: 0, waitingSince: at(60) });
    // Correction: back to active work for whoever fixes it.
    const correction = [...overlap, remove(80, "integration-ready"), add(80, "in-progress")];
    expect(progressPeriod(correction)).toEqual({ start: at(0), waitMs: 20 * min, waitingSince: null });
    // Pause: both removed, the issue leaves In progress and the next period starts fresh.
    const pause = [...overlap, remove(80, "integration-ready"), add(200, "in-progress")];
    expect(progressPeriod(pause)).toEqual({ start: at(200), waitMs: 0, waitingSince: null });
    // Reopening resets tracked periods; stale labels before it never count.
    const reopened = [add(0, "in-progress"), remove(60, "in-progress"), add(60, "integration-ready"), ev("closed", 70), ev("reopened", 90), add(95, "in-progress")];
    expect(progressPeriod(reopened)).toEqual({ start: at(95), waitMs: 0, waitingSince: null });
    expect(closedWorkPeriod(reopened.slice(0, 4), at(70))).toEqual({ start: at(0), waitMs: 10 * min });
  });
  it("keeps the wait when an issue is closed straight from integration-ready and ignores later events", () => {
    const events = [add(0, "in-progress"), remove(60, "in-progress"), add(60, "integration-ready"), ev("closed", 90), remove(91, "integration-ready"), add(92, "in-progress")];
    expect(closedWorkPeriod(events, at(90))).toEqual({ start: at(0), waitMs: 30 * min });
  });
  it("derives closed work starts and waits from repository events, and carries completed waits on closing", () => {
    const events = [...lifecycle()].map(event => ({ ...event, issue: { id: 1 } }));
    const lane: Lane = { repo: { full_name: "o/r" } as Lane["repo"], labels: [], issues: [issue([], { state: "closed", closed_at: at(130) })] };
    expect(deriveWorkStarts(lane, events).issues[0]).toMatchObject({ workStartedAt: at(0), waitMs: 40 * min });
    const old = issue(["in-progress"], { startedAt: at(0), waitMs: 40 * min });
    expect(carriedWork(issue([], { state: "closed", closed_at: at(130) }), old)).toEqual({ workStartedAt: at(0), waitMs: 40 * min });
    expect(carriedWork(issue([], { state: "closed", closed_at: at(130) }), { ...old, waitMs: undefined })).toEqual({ workStartedAt: at(0) });
  });
});

describe("active working time without integration waits (#392)", () => {
  const active = issue(["in-progress"], { startedAt: at(0), waitMs: 40 * min });
  const waiting = issue(["integration-ready"], { startedAt: at(0), waitingSince: at(60) });
  it("runs from a virtual active start and freezes while waiting", () => {
    expect(activeWorkStart(active)).toBe(at(40));
    expect(activeWorkMs(active, t0 + 130 * min)).toBe(90 * min);
    expect(activeWorkStart(waiting)).toBeNull();
    expect(activeWorkMs(waiting, t0 + 500 * min)).toBe(60 * min);
    // Labels decide: both labels count as active, unknown waits stay unknown.
    expect(activeWorkStart({ ...waiting, labels: [...waiting.labels, { name: "in-progress", color: "" }] })).toBe(at(0));
    expect(activeWorkMs({ ...waiting, waitingSince: undefined }, t0)).toBeNaN();
    expect(activeWorkStart({ ...active, timerError: true })).toBeNull();
    // Snapshots without waits keep the existing start.
    expect(activeWorkStart(issue(["in-progress"], { startedAt: at(0) }))).toBe(at(0));
  });
  it("measures closed work without its waits", () => {
    expect(closedWorkMs(issue([], { state: "closed", workStartedAt: at(0), closed_at: at(130), waitMs: 40 * min }))).toBe(90 * min);
    expect(closedWorkMs(issue([], { state: "closed", workStartedAt: at(0), closed_at: at(130) }))).toBe(130 * min);
    expect(closedWorkMs(issue([], { state: "closed", workStartedAt: at(0), closed_at: at(130), waitMs: 200 * min }))).toBeNaN();
  });
  it("uses only active time in estimates, remaining time and parallelism", () => {
    const now = t0 + 130 * min;
    const history = [1, 2, 3].map(id => issue([], { id, number: id, state: "closed", workStartedAt: iso(now - 5 * hour), closed_at: iso(now - 3 * hour), waitMs: hour }));
    const samples = historySamples(history, now);
    expect(samples.map(sample => sample.durationMs)).toEqual([hour, hour, hour]);
    expect(closedIssueOutcome(history[0]!, samples, now)).toMatchObject({ actualMs: hour });
    // One point at one hour per point; the waiting issue has 60 min active work and does not count down.
    const wait = { ...waiting, id: 10, number: 10 };
    expect(issueEstimate(wait, hour, now, true)).toEqual({ totalMs: hour, remainingMs: 0, overdue: false });
    expect(issueEstimate(wait, hour, now + 10 * hour, true)?.remainingMs).toBe(0);
    const half = { ...wait, waitingSince: at(30) };
    expect(issueEstimate(half, hour, now + 10 * hour, true)).toEqual({ totalMs: hour, remainingMs: 30 * min, overdue: false });
    expect(issueGroupEstimate(half, hour, now, true)).toMatchObject({ remainingMs: 30 * min, running: false, counting: false, ownSpentMs: 30 * min });
    const resumed = { ...active, id: 11, number: 11 };
    expect(issueEstimate(resumed, 2 * hour, now, true)).toMatchObject({ remainingMs: 30 * min });
    const estimate = repositoryEstimate([...history, half, resumed], now);
    expect(estimate.progress?.items.map(item => [item.issue.id, item.remainingMs, item.counting])).toEqual([[10, 30 * min, false], [11, 0, false]]);
    // A waiting issue occupies no capacity: only the running issue adds an interval.
    expect(parallelism([], [half, resumed], now)).toBe(1);
    expect(parallelism([], [half, { ...resumed, id: 12 }, resumed], now)).toBe(2);
  });
  it("never times out or flags inactivity while waiting, and times active work without its waits", () => {
    const now = t0 + 130 * min;
    const history = [1, 2, 3].map(id => issue([], { id, number: id, state: "closed", workStartedAt: iso(now - 5 * hour), closed_at: iso(now - 4 * hour) }));
    const settings = { timeoutEnabled: true, timeoutOverrunPercent: 0 };
    const lane = (items: Issue[]): Lane => ({ repo: { full_name: "o/r" } as Lane["repo"], labels: [], issues: [...items, ...history] });
    const wait = { ...waiting, id: 10, number: 10 };
    const resumed = { ...active, id: 11, number: 11 };
    const tracker = new TimeoutTracker();
    const scan = tracker.scan([lane([wait, resumed])], {}, settings, now);
    // 90 min active work against a 60 min estimate; the wait alone (60 min) would not be over it.
    expect(scan.active.map(entry => [entry.issue.id, entry.elapsedMs])).toEqual([[11, 90 * min]]);
    // Only the history expiry remains to schedule while the issue waits.
    expect(nextTimeout([lane([wait])], {}, settings, now)).toBe(now - 4 * hour + 30 * 86400000 + 1);
    expect(nextTimeout([lane([{ ...resumed, waitMs: 80 * min }])], {}, settings, t0 + 100 * min)).toBe(t0 + 140 * min + 1);
    expect(inactiveWork({ ...wait, updated_at: at(60) }, {}, now + 10 * hour)).toBeNull();
    expect(inactiveWork({ ...resumed, updated_at: at(60) }, {}, now + 10 * hour)).not.toBeNull();
    expect(repositoryActivity(lane([{ ...wait, updated_at: iso(now) }]), {}, now)).toBeNull();
  });
});
