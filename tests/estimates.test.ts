import { afterEach, describe, expect, it } from "vitest";
import {
  calibrationSamples,
  closedIssueOutcome,
  closedIssueGroupOutcome,
  combinedEstimate,
  estimateLabel,
  historySamples,
  issueEstimate,
  issueGroupEstimate,
  MAX_HISTORY_SAMPLES,
  subIssueGroupWork,
  nextHistoryExpiry,
  median,
  parallelism,
  otherRepositoryMembers,
  repositoryEstimate,
  typicalDuration,
} from "../src/lib/estimates";
import { setLanguage } from "../src/lib/i18n";
import type { Issue } from "../src/lib/model";

const now = Date.parse("2026-10-17T12:00:00Z");
const min = 60000, hour = 3600000, day = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
let id = 0;
function issue(state: "backlog" | "progress" | "closed", extra: Partial<Issue> = {}): Issue {
  id++;
  return {
    id, number: id, title: `#${id}`, html_url: "", created_at: iso(now - 40 * day), updated_at: iso(now),
    state: state === "closed" ? "closed" : "open", closed_at: null,
    labels: state === "progress" ? [{ name: "in progress", color: "" }] : [], assignees: [], ...extra,
  };
}
/** Closed issue that was in progress for `duration`, closing `ago` before now. */
const done = (duration: number, ago = hour) =>
  issue("closed", { startedAt: iso(now - ago - duration), closed_at: iso(now - ago) });
const running = (elapsed: number) => issue("progress", { startedAt: iso(now - elapsed) });
afterEach(() => setLanguage("auto"));

describe("history selection", () => {
  it("uses closed issues within the window that have a start time", () => {
    const kept = done(30 * min);
    const samples = historySamples([
      kept,
      issue("closed", { closed_at: iso(now - hour) }), // never in progress
      done(30 * min, 31 * day), // outside the window
      running(10 * min),
      issue("backlog"),
      { ...done(10 * min), pull_request: {} },
    ], now);
    expect(samples.map((s) => s.issue)).toEqual([kept]);
    expect(samples[0]!.durationMs).toBe(30 * min);
  });
  it("respects a custom progress rule when classifying columns", () => {
    const custom = issue("backlog", { labels: [{ name: "Doing now", color: "" }], startedAt: iso(now - hour) });
    const estimate = repositoryEstimate([done(hour), done(hour), done(hour), custom], now, { rules: { progress: "Doing now" } });
    expect(estimate.progress?.count).toBe(1);
    expect(estimate.backlog).toBeNull();
  });
});

describe("typical time", () => {
  it("needs at least three samples", () => {
    expect(typicalDuration(historySamples([done(hour), done(hour)], now))).toBeNull();
    const estimate = repositoryEstimate([done(hour), done(hour), running(min), issue("backlog")], now);
    expect(estimate).toMatchObject({ basis: { samples: 2, typicalMs: null, windowDays: 30 }, progress: null, backlog: null });
  });
  it("uses the median so outliers do not dominate", () => {
    const samples = historySamples([done(20 * min), done(30 * min), done(40 * min), done(10 * day)], now);
    expect(typicalDuration(samples)).toBe(35 * min);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe("in progress", () => {
  it("finishes with the longest remaining issue and flags overdue ones", () => {
    const history = [done(hour, 20 * day), done(hour, 10 * day), done(hour, 5 * day)];
    const estimate = repositoryEstimate([...history, running(10 * min), running(40 * min), running(3 * hour)], now);
    expect(estimate.basis.typicalMs).toBe(hour);
    expect(estimate.progress).toMatchObject({ count: 3, remainingMs: 50 * min, overdue: 1, unknownStart: 0 });
    expect(estimate.progress!.items.map((item) => item.remainingMs)).toEqual([50 * min, 20 * min, 0]);
  });
  it("is zero when every issue is overdue and assumes full time for unknown starts", () => {
    const history = [done(hour, 20 * day), done(hour, 10 * day), done(hour, 5 * day)];
    expect(repositoryEstimate([...history, running(2 * hour)], now).progress)
      .toMatchObject({ remainingMs: 0, overdue: 1 });
    expect(repositoryEstimate([...history, issue("progress")], now).progress)
      .toMatchObject({ remainingMs: hour, overdue: 0, unknownStart: 1 });
  });
  it("leaves empty columns without an estimate", () => {
    const estimate = repositoryEstimate([done(hour), done(hour), done(hour)], now);
    expect(estimate.basis.typicalMs).toBe(hour);
    expect(estimate.progress).toBeNull();
    expect(estimate.backlog).toBeNull();
  });
});

describe("parallelism", () => {
  it("is the average concurrency while any work was in progress", () => {
    // Two overlapping one-hour issues, then a separate one: 3 h of work over 2 h busy time.
    const samples = historySamples([done(hour, 10 * day), done(hour, 10 * day), done(hour, 2 * day)], now);
    expect(parallelism(samples, [], now)).toBe(1.5);
  });
  it("counts current in-progress issues and clips to the window", () => {
    const samples = historySamples([done(2 * hour, hour)], now);
    expect(parallelism(samples, [running(3 * hour)], now)).toBeCloseTo(5 / 3);
    const old = historySamples([issue("closed", { startedAt: iso(now - 40 * day), closed_at: iso(now - 29 * day) })], now);
    expect(old[0]!.durationMs).toBe(11 * day);
    expect(parallelism([...old, ...historySamples([done(day, 28.5 * day)], now)], [], now)).toBeCloseTo(4 / 3);
  });
  it("is never below one", () => {
    expect(parallelism([], [], now)).toBe(1);
    expect(parallelism(historySamples([done(hour, 2 * day), done(hour, day)], now), [], now)).toBe(1);
  });
  it("divides backlog work by parallelism after in-progress work", () => {
    const history = [done(hour, 10 * day), done(hour, 10 * day), done(hour, 5 * day), done(hour, 5 * day)];
    const estimate = repositoryEstimate([...history, running(30 * min), issue("backlog"), issue("backlog"), issue("backlog")], now);
    // Parallelism: 4 h of history + 30 min current over 2.5 h busy time = 1.8.
    expect(estimate.basis.parallelism).toBeCloseTo(1.8);
    expect(estimate.backlog!.count).toBe(3);
    expect(estimate.backlog!.remainingMs).toBeCloseTo(30 * min + (3 * hour) / 1.8);
  });
  it("starts the backlog immediately without work in progress", () => {
    const estimate = repositoryEstimate([done(hour), done(hour, 2 * day), done(hour, 3 * day), issue("backlog")], now);
    expect(estimate.backlog).toEqual({ count: 1, points: 1, remainingMs: hour });
  });
});

describe("combined board", () => {
  const history = (duration: number) => [done(duration, 20 * day), done(duration, 10 * day), done(duration, 5 * day)];
  it("takes the slowest repository per column and skips repositories without data", () => {
    const fast = repositoryEstimate([...history(hour), running(30 * min), running(2 * hour), issue("backlog")], now);
    const slow = repositoryEstimate([...history(4 * hour), running(hour)], now);
    const unknown = repositoryEstimate([done(hour), running(min), issue("backlog")], now);
    // fast: 3 h history + 2.5 h current over 5 h busy time gives parallelism 1.1.
    expect(fast.basis.parallelism).toBeCloseTo(1.1);
    expect(combinedEstimate([fast, slow, unknown])).toEqual({
      repositories: 2,
      samples: 6,
      windowDays: 30,
      progress: { count: 3, points: 3, remainingMs: 3 * hour, overdue: 1 },
      backlog: { count: 1, points: 1, remainingMs: fast.backlog!.remainingMs },
    });
    expect(fast.backlog!.remainingMs).toBeCloseTo(30 * min + hour / 1.1);
  });
  it("is null without any repository estimate", () => {
    expect(combinedEstimate([])).toBeNull();
    expect(combinedEstimate([repositoryEstimate([issue("backlog")], now)])).toBeNull();
  });
});

describe("duration label", () => {
  it("formats compact approximate durations", () => {
    setLanguage("sv");
    expect(estimateLabel(20 * 1000)).toBe("< 1 min");
    expect(estimateLabel(25 * min)).toBe("≈ 25 min");
    expect(estimateLabel(3 * hour + 10 * min)).toBe("≈ 3 h 10 min");
    expect(estimateLabel(2 * hour)).toBe("≈ 2 h");
    expect(estimateLabel(2 * day + 4 * hour + 10 * min)).toBe("≈ 2 d 4 h");
    setLanguage("en");
    expect(estimateLabel(3 * day)).toBe("≈ 3 d");
    expect(estimateLabel(59.6 * min)).toBe("≈ 1 h");
    expect(estimateLabel(Number.NaN)).toBe("");
  });
});

describe("recent point-calibrated forecasts", () => {
  const sized = (points: number) => ({ name: `points: ${points}`, color: "000000" });
  it("caps calibration to the latest 30 eligible closures regardless of input order", () => {
    const history = Array.from({ length: 40 }, (_, index) => done(index < 30 ? hour : 100 * hour, index * hour));
    const samples = historySamples([...history].reverse(), now);
    expect(samples).toHaveLength(MAX_HISTORY_SAMPLES);
    expect(samples.map(sample => sample.issue.id)).toEqual(history.slice(0, 30).map(issue => issue.id));
    expect(repositoryEstimate([...history, issue("backlog")], now).basis.msPerPoint).toBe(hour);
  });
  it("keeps the exact window edge, excludes invalid/future/zero durations and wakes after expiry", () => {
    const edge = done(hour, 30 * day);
    const items = [edge, done(hour, 30 * day - min), done(hour, 30 * day - 2 * min),
      done(hour, 30 * day + 1), done(hour, -min), done(0), done(-min),
      issue("closed", { workStartedAt: "invalid", startedAt: iso(now - hour), closed_at: iso(now) })];
    expect(historySamples(items, now)).toHaveLength(3);
    expect(nextHistoryExpiry(items, now)).toBe(now + 1);
    expect(repositoryEstimate([...items, issue("backlog")], now).backlog).not.toBeNull();
    expect(repositoryEstimate([...items, issue("backlog")], now + 1).backlog).toBeNull();
    expect(nextHistoryExpiry(items, now + 1)).toBe(now + min + 1);
    expect(nextHistoryExpiry([], now)).toBeNull();
  });
  it("learns a robust time per point, then sizes each issue before subtracting elapsed work", () => {
    const history = [
      { ...done(hour, 20 * day), labels: [sized(1)] },
      { ...done(3 * hour, 10 * day), labels: [sized(3)] },
      { ...done(5 * hour, 5 * day), labels: [sized(5)] },
      { ...done(100 * hour, day), labels: [sized(1)] },
    ];
    const small = repositoryEstimate([...history, issue("backlog", { labels: [sized(1)] })], now);
    const large = repositoryEstimate([...history, issue("backlog", { labels: [sized(8)] })], now);
    expect(small.basis.typicalMs).toBe(3 * hour);
    expect(small.basis.msPerPoint).toBe(hour);
    expect(large.backlog!.remainingMs / small.backlog!.remainingMs).toBe(8);
    const progress = repositoryEstimate([...history,
      issue("progress", { labels: [{ name: "in-progress", color: "" }, sized(5)], startedAt: iso(now - 30 * min) }),
      issue("progress", { labels: [{ name: "in-progress", color: "" }, sized(3)] }),
      issue("progress", { labels: [{ name: "in-progress", color: "" }, sized(1)], startedAt: iso(now - 2 * hour) }),
    ], now).progress!;
    expect(progress).toMatchObject({ points: 9, remainingMs: 4.5 * hour, overdue: 1, unknownStart: 1 });
    expect(progress.items.map(item => item.remainingMs)).toEqual([4.5 * hour, 3 * hour, 0]);
  });
});


describe("individual issue forecasts", () => {
  it("shares the repository's point calibration and counts down without changing total", () => {
    const active = running(10 * min);
    active.labels.push({ name: "points: 3", color: "" });
    const estimate = repositoryEstimate([done(hour), done(hour), done(hour), active], now);
    const initial = issueEstimate(active, estimate.basis.msPerPoint, now, true)!;
    expect(initial).toEqual({ totalMs: 3 * hour, remainingMs: 170 * min, overdue: false });
    expect(initial.remainingMs).toBe(estimate.progress!.items[0]!.remainingMs);
    expect(issueEstimate(active, estimate.basis.msPerPoint, now + 5 * min, true))
      .toEqual({ totalMs: 3 * hour, remainingMs: 165 * min, overdue: false });
  });
  it("omits forecasts without history and remaining time without a safe active start", () => {
    const unknown = issue("progress");
    for (const rate of [null, undefined, 0, -1, Infinity, NaN]) expect(issueEstimate(unknown, rate, now, true)).toBeNull();
    for (const startedAt of [undefined, null, "invalid", iso(now + min)]) {
      expect(issueEstimate({ ...unknown, startedAt }, hour, now, true))
        .toEqual({ totalMs: hour, remainingMs: null, overdue: false });
    }
    expect(issueEstimate(running(10 * min), hour, now, false)?.remainingMs).toBeNull();
  });
  it("never gives negative remaining time and explicitly flags overdue work", () => {
    expect(issueEstimate(running(2 * hour), hour, now, true))
      .toEqual({ totalMs: hour, remainingMs: 0, overdue: true });
    expect(issueEstimate(running(hour), hour, now, true))
      .toEqual({ totalMs: hour, remainingMs: 0, overdue: false });
  });
});

describe("closed implementation outcome", () => {
  it("compares against other issues only, with over, under and equal durations", () => {
    const history = [done(hour), done(hour), done(hour)];
    for (const duration of [hour / 2, hour, hour * 2]) {
      const target = done(duration);
      const outcome = closedIssueOutcome(target, historySamples([...history, target], now), now)!;
      expect(outcome.actualMs).toBe(duration);
      expect(outcome.estimatedMs).toBe(hour);
    }
    expect(closedIssueOutcome(history[0]!, historySamples(history, now), now)?.estimatedMs).toBeNull();
  });
  it("uses a safe work start, never creation age, and rejects invalid closures", () => {
    const target = done(hour);
    target.workStartedAt = iso(now - 3 * hour);
    expect(closedIssueOutcome(target, [], now)).toEqual({ actualMs: 2 * hour, estimatedMs: null });
    for (const extra of [{ startedAt: undefined }, { closed_at: iso(now + hour) }, { startedAt: iso(now) }, { pull_request: {} }]) {
      expect(closedIssueOutcome({ ...done(hour), ...extra }, [], now)).toBeNull();
    }
  });
});

it("includes the extra comparison sample when scheduling rolling-history expiry", () => {
  const history = Array.from({ length: MAX_HISTORY_SAMPLES + 1 }, (_, index) => done(hour, (index + 1) * hour));
  const oldest = Date.parse(history.at(-1)!.closed_at!);
  expect(nextHistoryExpiry(history, now, { sampleLimit: MAX_HISTORY_SAMPLES + 1 })).toBe(oldest + 30 * day + 1);
  expect(nextHistoryExpiry(history, now)).toBe(oldest + hour + 30 * day + 1);
});

describe("extreme duration exclusion", () => {
  const sized = (points: number, duration: number) => ({ ...done(duration), labels: [{ name: `points: ${points}`, color: "" }] });
  it("excludes a 15-hour interruption from 60-minute history while preserving its observed duration", () => {
    const normal = [done(45 * min), done(hour), done(75 * min)];
    const interrupted = done(15 * hour);
    const expected = repositoryEstimate([...normal, running(10 * min), issue("backlog")], now);
    const actual = repositoryEstimate([...normal, interrupted, running(10 * min), issue("backlog")], now);
    expect(actual.basis).toEqual(expected.basis);
    expect(actual.basis.samples).toBe(3);
    expect(actual.progress?.remainingMs).toBe(50 * min);
    expect(actual.backlog).toEqual(expected.backlog);
    expect(closedIssueOutcome(interrupted, historySamples([...normal, interrupted], now), now))
      .toEqual({ actualMs: 15 * hour, estimatedMs: hour });
  });
  it("excludes multiple extreme runs from rate, typical time and parallelism", () => {
    const normal = [done(45 * min), done(hour), done(75 * min)];
    const list = [...normal, done(15 * hour), done(20 * hour)];
    expect(repositoryEstimate(list, now).basis).toEqual(repositoryEstimate(normal, now).basis);
    const target = done(2 * hour);
    expect(closedIssueOutcome(target, historySamples([...list, target], now), now)?.estimatedMs).toBe(hour);
  });
  it("normalizes by points and keeps large proportional work, ordinary overruns and the exact threshold", () => {
    const list = [sized(1, hour), sized(3, 3 * hour), sized(5, 5 * hour), sized(13, 13 * hour), sized(1, 4 * hour), sized(1, 4 * hour + 1)];
    expect(calibrationSamples(historySamples(list, now)).map(sample => sample.issue.id)).toEqual(historySamples(list.slice(0, -1), now).map(sample => sample.issue.id));
    expect(repositoryEstimate(list, now).basis).toMatchObject({ samples: 5, msPerPoint: hour });
  });
  it("requires three retained samples rather than padding the evidence with an extreme run", () => {
    const history = [done(hour), done(hour), done(15 * hour)];
    const estimate = repositoryEstimate([...history, running(10 * min), issue("backlog")], now);
    expect(estimate.basis).toMatchObject({ samples: 2, msPerPoint: null, typicalMs: null });
    expect(estimate.progress).toBeNull();
    expect(estimate.backlog).toBeNull();
    const target = done(30 * min);
    expect(closedIssueOutcome(target, historySamples([...history, target], now), now)).toEqual({ actualMs: 30 * min, estimatedMs: null });
  });
});

describe("closed parent group duration", () => {
  it("sums complete parent and child work intervals, including sequential or overlapping work", () => {
    const parent = issue("closed", { startedAt: iso(now - 5 * hour), closed_at: iso(now - hour) });
    const first = issue("closed", { startedAt: iso(now - 4 * hour), closed_at: iso(now - 3 * hour) });
    const second = issue("closed", { startedAt: iso(now - 3 * hour), closed_at: iso(now - hour) });
    expect(closedIssueGroupOutcome(parent, [first, second], [], now)).toMatchObject({ actualMs: 7 * hour, aggregation: "sum" });
    const overlapping = { ...second, startedAt: iso(now - 4 * hour) };
    expect(closedIssueGroupOutcome(parent, [first, overlapping], [], now)).toMatchObject({ actualMs: 8 * hour, aggregation: "sum" });
  });

  it("uses the earliest known start to latest close when any member start is missing", () => {
    const parent = issue("closed", { startedAt: iso(now - 5 * hour), closed_at: iso(now - hour) });
    const child = issue("closed", { closed_at: iso(now - 2 * hour) });
    expect(closedIssueGroupOutcome(parent, [child], [], now)).toMatchObject({ actualMs: 4 * hour, aggregation: "span" });
  });

  it("returns unknown when any member closure is missing and preserves standalone behavior", () => {
    const parent = done(2 * hour);
    const child = issue("closed", { startedAt: iso(now - hour) });
    expect(closedIssueGroupOutcome(parent, [child], [], now)).toBeNull();
    expect(closedIssueGroupOutcome(parent, [], [], now)).toEqual(closedIssueOutcome(parent, [], now));
  });
});

describe("sub-issue time deduction (#279)", () => {
  const history = () => [done(hour, 20 * day), done(hour, 10 * day), done(hour, 5 * day)];
  const sized = (state: "backlog" | "progress", points: number, extra: Partial<Issue> = {}) => issue(state, {
    labels: [...(state === "progress" ? [{ name: "in progress", color: "" }] : []), { name: `points: ${points}`, color: "" }], ...extra,
  });
  const offBoardClosed = (duration: number, ago = hour) => issue("closed", { startedAt: iso(now - ago - duration), closed_at: iso(now - ago) });
  const tree = (entries: [Issue, Issue[]][]) => new Map(entries.map(([parent, children]) => [parent.id, children.map(child => ({ issue: child }))]));

  it("deducts the parent's own elapsed time and never goes negative", () => {
    const parent = sized("progress", 2, { startedAt: iso(now - 30 * min) });
    expect(repositoryEstimate([...history(), parent], now).progress).toMatchObject({ remainingMs: 90 * min, overdue: 0 });
    const late = sized("progress", 1, { startedAt: iso(now - 3 * hour) });
    expect(repositoryEstimate([...history(), late], now).progress).toMatchObject({ remainingMs: 0, overdue: 1 });
  });

  it("deducts a running child and a closed child from an in-progress parent", () => {
    const parent = sized("progress", 5, { startedAt: iso(now - hour) });
    const child = running(30 * min), closed = offBoardClosed(45 * min);
    const estimate = repositoryEstimate([...history(), parent, child], now, { children: tree([[parent, [child, closed]]]) });
    expect(estimate.progress).toMatchObject({ count: 1, points: 5, remainingMs: 5 * hour - hour - 30 * min - 45 * min, overdue: 0 });
    expect(estimate.progress!.items[0]).toMatchObject({ issue: parent, subIssueSpentMs: 75 * min, subIssues: 2, counting: true });
  });

  it("deducts closed and running children from a backlog parent and moves the group into progress while work runs", () => {
    const parent = sized("backlog", 5), child = running(30 * min), closed = offBoardClosed(hour);
    const other = sized("backlog", 1);
    const estimate = repositoryEstimate([...history(), parent, child, other], now, { children: tree([[parent, [child, closed]]]) });
    expect(estimate.progress).toMatchObject({ count: 1, remainingMs: 5 * hour - hour - 30 * min, unknownStart: 0 });
    expect(estimate.progress!.items[0]).toMatchObject({ issue: parent, counting: true });
    expect(estimate.backlog).toMatchObject({ count: 1, points: 1, remainingMs: 3.5 * hour + hour });
    const waiting = repositoryEstimate([...history(), parent], now, { children: tree([[parent, [closed]]]) });
    expect(waiting.progress).toBeNull();
    expect(waiting.backlog).toMatchObject({ count: 1, points: 5, remainingMs: 4 * hour });
  });

  it("counts each child once: absorbed, deduplicated and nested children do not reduce twice", () => {
    const parent = sized("progress", 5, { startedAt: iso(now - hour) });
    const child = sized("progress", 3, { startedAt: iso(now - 20 * min) });
    const grandchild = running(10 * min);
    const without = repositoryEstimate([...history(), parent, child, grandchild], now);
    expect(without.progress).toMatchObject({ count: 3, remainingMs: 4 * hour });
    const children = tree([[parent, [child, child]], [child, [grandchild]]]);
    const estimate = repositoryEstimate([...history(), parent, child, grandchild], now, { children });
    expect(estimate.progress).toMatchObject({ count: 1, points: 5, remainingMs: 5 * hour - hour - 20 * min - 10 * min });
    expect(estimate.progress!.items[0]).toMatchObject({ subIssueSpentMs: 30 * min, subIssues: 2 });
    // Sub-issue time beyond the parent estimate is overdue, not negative.
    const big = repositoryEstimate([...history(), parent], now, { children: tree([[parent, [offBoardClosed(5 * hour)]]]) });
    expect(big.progress).toMatchObject({ remainingMs: 0, overdue: 1 });
  });

  it("ignores backlog children, closures outside the window and closed parents", () => {
    const parent = sized("progress", 2, { startedAt: iso(now - 30 * min) });
    const old = offBoardClosed(hour, 40 * day), idle = issue("backlog");
    const estimate = repositoryEstimate([...history(), parent, idle], now, { children: tree([[parent, [old, idle]]]) });
    expect(estimate.progress).toMatchObject({ count: 1, remainingMs: 90 * min });
    expect(estimate.backlog).toMatchObject({ count: 0, points: 0, remainingMs: 90 * min });
    const closedParent = done(hour), child = running(10 * min);
    expect(repositoryEstimate([...history(), closedParent, child], now, { children: tree([[closedParent, [child]]]) }).progress)
      .toMatchObject({ count: 1, remainingMs: 50 * min });
  });
});

describe("parent card forecast with sub-issue groups (#281)", () => {
  const history = () => [done(hour, 20 * day), done(hour, 10 * day), done(hour, 5 * day)];
  const sized = (state: "backlog" | "progress", points: number, extra: Partial<Issue> = {}) => issue(state, {
    labels: [...(state === "progress" ? [{ name: "in progress", color: "" }] : []), { name: `points: ${points}`, color: "" }], ...extra,
  });
  const offBoardClosed = (duration: number, ago = hour) => issue("closed", { startedAt: iso(now - ago - duration), closed_at: iso(now - ago) });
  const tree = (entries: [Issue, Issue[]][]) => new Map(entries.map(([parent, children]) => [parent.id, children.map(child => ({ issue: child }))]));
  /** Card forecast for `parent` with the same board members, children and rate as the column badge. */
  const card = (parent: Issue, board: Issue[], children: ReturnType<typeof tree>, inProgress: boolean, at = now) => {
    const estimate = repositoryEstimate(board, at, { children });
    const members = new Map(board.filter(entry => entry.state === "open").map(entry => [entry.id, entry] as const));
    const work = subIssueGroupWork(parent, members, at, {}, 30, children);
    return { estimate, forecast: issueGroupEstimate(parent, estimate.basis.msPerPoint, at, inProgress, work)! };
  };

  it("matches the badge for an in-progress parent with running and closed sub-issues", () => {
    const parent = sized("progress", 5, { startedAt: iso(now - hour) });
    const child = running(30 * min), closed = offBoardClosed(45 * min);
    const { estimate, forecast } = card(parent, [...history(), parent, child], tree([[parent, [child, closed]]]), true);
    expect(forecast).toMatchObject({ totalMs: 5 * hour, remainingMs: 5 * hour - hour - 75 * min, overdue: false,
      ownSpentMs: hour, subIssueSpentMs: 75 * min, subIssues: 2, running: true, counting: true });
    expect(forecast.remainingMs).toBe(estimate.progress!.items[0]!.remainingMs);
    // Before its sub-issues load the card keeps its own normal forecast.
    expect(issueGroupEstimate(parent, hour, now, true, null)).toMatchObject({ ...issueEstimate(parent, hour, now, true), subIssueSpentMs: 0 });
  });

  it("gives a backlog parent the group's countdown only once sub-issue work has started", () => {
    const parent = sized("backlog", 5), child = running(30 * min), closed = offBoardClosed(hour);
    const board = [...history(), parent, child], children = tree([[parent, [child, closed]]]);
    const { estimate, forecast } = card(parent, board, children, false);
    expect(forecast).toMatchObject({ remainingMs: 5 * hour - 90 * min, ownSpentMs: 0, subIssueSpentMs: 90 * min, counting: true });
    expect(forecast.remainingMs).toBe(estimate.progress!.items[0]!.remainingMs);
    expect(card(parent, board, children, false, now + 10 * min).forecast.remainingMs).toBe(5 * hour - 100 * min);
    // Only closed work: a static remaining time that does not count down.
    expect(card(parent, [...history(), parent], tree([[parent, [closed]]]), false).forecast)
      .toMatchObject({ remainingMs: 4 * hour, counting: false, running: false });
    // Nothing started: the normal total-only forecast.
    expect(card(parent, [...history(), parent], tree([[parent, [issue("backlog")]]]), false).forecast)
      .toMatchObject({ totalMs: 5 * hour, remainingMs: null, subIssueSpentMs: 0 });
  });

  it("counts nested sub-issues once and reports overtime instead of negative time", () => {
    const parent = sized("progress", 2, { startedAt: iso(now - hour) });
    const child = sized("progress", 3, { startedAt: iso(now - 50 * min) }), grandchild = running(20 * min);
    const children = tree([[parent, [child, child]], [child, [grandchild]]]);
    const { estimate, forecast } = card(parent, [...history(), parent, child, grandchild], children, true);
    expect(forecast).toMatchObject({ subIssueSpentMs: 70 * min, subIssues: 2, remainingMs: 0, overdue: true,
      overtimeMs: 10 * min, running: true, counting: false });
    expect(estimate.progress).toMatchObject({ count: 1, overdue: 1, remainingMs: 0 });
  });
});

describe("consistent sub-issue groups (#287)", () => {
  const history = () => [done(hour, 20 * day), done(hour, 10 * day), done(hour, 5 * day)];
  const sized = (state: "backlog" | "progress", points: number, extra: Partial<Issue> = {}) => issue(state, {
    labels: [...(state === "progress" ? [{ name: "in progress", color: "" }] : []), { name: `points: ${points}`, color: "" }], ...extra,
  });
  const closedChild = (duration: number) => issue("closed", { startedAt: iso(now - hour - duration), closed_at: iso(now - hour) });
  const tree = (entries: [Issue, Issue[]][]) => new Map(entries.map(([parent, children]) => [parent.id, children.map(child => ({ issue: child }))]));

  it("derives each column's count and points from the same groups", () => {
    const parent = sized("backlog", 5), first = sized("progress", 2, { startedAt: iso(now - 10 * min) });
    const second = sized("progress", 2, { startedAt: iso(now - 20 * min) }), other = sized("backlog", 1);
    const estimate = repositoryEstimate([...history(), parent, first, second, other], now, { children: tree([[parent, [first, second]]]) });
    expect(estimate.progress).toMatchObject({ count: 1, points: 5 });
    // The promoted parent is counted where its points are: In progress, not also in the Backlog.
    expect(estimate.backlog).toMatchObject({ count: 1, points: 1 });
    // Only promoted groups waiting: the Backlog column still finishes with them, with nothing of its own.
    expect(repositoryEstimate([...history(), parent, first], now, { children: tree([[parent, [first]]]) }).backlog)
      .toMatchObject({ count: 0, points: 0, remainingMs: 5 * hour - 10 * min });
  });

  it("absorbs a member reached through a sub-issue outside the list, so its time counts once", () => {
    const parent = sized("progress", 5, { startedAt: iso(now - hour) });
    const middle = sized("progress", 2, { startedAt: iso(now - 20 * min) }), grandchild = running(10 * min);
    const children = tree([[parent, [middle]], [middle, [grandchild]]]);
    // `middle` belongs to another repository's list; `grandchild` is on this one.
    const estimate = repositoryEstimate([...history(), parent, grandchild], now, { children });
    expect(estimate.progress).toMatchObject({ count: 1, points: 5, remainingMs: 5 * hour - hour - 20 * min - 10 * min });
  });

  it("deducts each sub-issue at most once across repositories on a combined board", () => {
    const parent = sized("progress", 5, { startedAt: iso(now - hour) }), grandchild = running(10 * min);
    const middle = sized("progress", 2, { startedAt: iso(now - 20 * min) }), closed = closedChild(30 * min);
    const children = tree([[parent, [middle]], [middle, [grandchild, closed]]]);
    const groups = [{ issues: [...history(), parent, grandchild] }, { issues: [...history(), middle] }];
    const external = otherRepositoryMembers(groups);
    expect([...external[0]!]).toEqual([middle.id]);
    const [a, b] = groups.map((group, index) => repositoryEstimate(group.issues, now, { children, external: external[index] }));
    // Repository B estimates `middle` with its closed child; A's parent does not reach into it.
    expect(b!.progress!.items).toMatchObject([{ issue: middle, subIssueSpentMs: 30 * min, subIssues: 1 }]);
    // `grandchild` is on A's own board but estimated as its own item, since B's `middle` cuts the path.
    expect(a!.progress!.items).toMatchObject([{ issue: parent, subIssueSpentMs: 0 }, { issue: grandchild, subIssueSpentMs: 0 }]);
    const deducted = [...a!.progress!.items, ...b!.progress!.items].reduce((sum, item) => sum + item.subIssueSpentMs, 0);
    expect(deducted).toBe(30 * min);
    // The parent's card applies the same cut.
    const members = new Map([parent, grandchild].map(entry => [entry.id, entry] as const));
    expect(subIssueGroupWork(parent, members, now, {}, 30, children, external[0])).toMatchObject({ spentMs: 0, descendants: 0 });
  });

  it("never marks an unknown-start item both full-time and overdue", () => {
    const parent = sized("progress", 1), closed = closedChild(2 * hour);
    const deducted = repositoryEstimate([...history(), parent], now, { children: tree([[parent, [closed]]]) }).progress!;
    expect(deducted).toMatchObject({ remainingMs: 0, overdue: 1, unknownStart: 0 });
    expect(deducted.items[0]).toMatchObject({ unknownStart: false, overdue: true, subIssueSpentMs: 2 * hour });
    // Without deducted sub-issue time the full estimated time is assumed, never overdue.
    const full = repositoryEstimate([...history(), parent], now, { children: tree([[parent, [issue("backlog")]]]) }).progress!;
    expect(full).toMatchObject({ remainingMs: hour, overdue: 0, unknownStart: 1 });
  });
});


it("carries arbitrary explicit sizes into calibration, column totals and individual time forecasts (#340)", () => {
  const history = [1, 2, 3].map(i => ({ ...done(4 * hour, i * day), labels: [{ name: "sp-4", color: "" }] }));
  const backlog = issue("backlog", { labels: [{ name: "sp-4", color: "" }] });
  const active = issue("progress", { startedAt: iso(now - hour), labels: [{ name: "in-progress", color: "" }, { name: "SP: 5", color: "" }] });
  const estimate = repositoryEstimate([...history, backlog, active], now);
  expect(estimate.basis.msPerPoint).toBe(hour);
  expect(estimate.progress).toMatchObject({ points: 5, remainingMs: 4 * hour });
  expect(estimate.backlog?.points).toBe(4);
  expect(issueEstimate(backlog, estimate.basis.msPerPoint, now, false)?.totalMs).toBe(4 * hour);
  expect(issueEstimate(active, estimate.basis.msPerPoint, now, true)).toMatchObject({ totalMs: 5 * hour, remainingMs: 4 * hour });
  const largest = issue("backlog", { labels: [{ name: `sp-${Number.MAX_SAFE_INTEGER}`, color: "" }] });
  expect(Number.isFinite(issueEstimate(largest, hour, now, false)!.totalMs)).toBe(true);
  expect(issueEstimate(largest, Number.MAX_VALUE, now, false)).toBeNull();
});
