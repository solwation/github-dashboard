import { afterEach, describe, expect, it } from "vitest";
import {
  closedIssueOutcome,
  combinedEstimate,
  estimateLabel,
  historySamples,
  issueEstimate,
  MAX_HISTORY_SAMPLES,
  nextHistoryExpiry,
  median,
  parallelism,
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
    expect(small.basis.typicalMs).toBe(4 * hour);
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
