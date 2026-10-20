import { t } from "./i18n";
import { approximatePoints } from "./story-points";
import { column, type Issue, type Rules } from "./model";

/**
 * Pure time estimates for the board (#138). Nothing here fetches data: callers pass the lane
 * issues they already show, after their own filters (hidden coordination, search), plus `now`.
 *
 * Model:
 * - History: the most recent 30 positive start → close durations within 30 days, with a known
 *   workStartedAt (falling back to startedAt). Unknown/future/invalid closures never calibrate.
 * - Size: approximatePoints supplies bounded local 1–13 point scores, not measured complexity.
 * - Calibration: median(duration / points) per repository; fewer than MIN_SAMPLES gives no estimate.
 * - In progress: max(0, points × calibrated time per point − elapsed). The longest remaining issue
 *   decides. Past-due issues count as zero and unknown starts need their full point-based duration.
 * - Parallelism: the time-weighted average number of issues in progress while at least one was in
 *   progress, over the window: sum of in-progress durations (history plus current in-progress
 *   issues, clipped to the window) divided by the length of their union. Idle periods such as
 *   nights do not dilute it. Never below 1.
 * - Backlog: in-progress remaining time + backlog points × time per point ÷ parallelism, since backlog
 *   work starts when capacity frees up.
 * - Combined board: repositories work independently in parallel, so each column finishes when
 *   the slowest repository finishes (maximum per column). Repositories without an estimate are
 *   skipped.
 */
export const ESTIMATE_WINDOW_DAYS = 30;
export const MIN_SAMPLES = 3;
export const MAX_HISTORY_SAMPLES = 30;
const DAY_MS = 86400000;

export interface HistorySample {
  issue: Issue;
  startedMs: number;
  closedMs: number;
  durationMs: number;
}
export interface EstimateBasis {
  /** Number of recent eligible closures used, capped at MAX_HISTORY_SAMPLES. */
  samples: number;
  /** Raw median duration retained for existing consumers; forecasts use msPerPoint. */
  typicalMs: number | null;
  /** Median positive duration divided by approximate issue points. */
  msPerPoint: number | null;
  windowDays: number;
  /** Average concurrent in-progress issues, at least 1. */
  parallelism: number;
}
export interface ProgressItemEstimate {
  issue: Issue;
  remainingMs: number;
  points: number;
  overdue: boolean;
  /** Start time was unknown; the full point-based duration is assumed. */
  unknownStart: boolean;
}
export interface ColumnEstimate {
  /** Issues in the column. */
  count: number;
  /** Sum of bounded approximate issue sizes in this column. */
  points: number;
  /** Time until the column is done, from `now`. */
  remainingMs: number;
}
export interface ProgressEstimate extends ColumnEstimate {
  /** Issues past the typical time; they count as 0 remaining. */
  overdue: number;
  unknownStart: number;
  items: ProgressItemEstimate[];
}
export interface RepositoryEstimate {
  basis: EstimateBasis;
  /** Null when the column is empty or there is no typical time. */
  progress: ProgressEstimate | null;
  /** Null when the backlog is empty or there is no typical time. */
  backlog: ColumnEstimate | null;
}
export interface CombinedEstimate {
  /** Repositories that contributed a typical time. */
  repositories: number;
  samples: number;
  windowDays: number;
  progress: (ColumnEstimate & { overdue: number }) | null;
  backlog: ColumnEstimate | null;
}
export interface EstimateOptions {
  rules?: Rules;
  windowDays?: number;
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);
const issuesOf = (issues: Issue[]) => issues.filter((issue) => !issue.pull_request);

/** Most recent eligible closures in the rolling window, capped before calibration and concurrency. */
export function historySamples(
  issues: Issue[],
  now: number,
  { rules = {}, windowDays = ESTIMATE_WINDOW_DAYS }: EstimateOptions = {},
): HistorySample[] {
  const cutoff = now - windowDays * DAY_MS;
  const samples: HistorySample[] = [];
  for (const issue of issuesOf(issues)) {
    if (column(issue, rules) !== "closed") continue;
    const startedMs = time(issue.workStartedAt ?? issue.startedAt), closedMs = time(issue.closed_at);
    if (!Number.isFinite(startedMs) || !Number.isFinite(closedMs)) continue;
    if (closedMs < cutoff || closedMs > now || closedMs <= startedMs) continue;
    samples.push({ issue, startedMs, closedMs, durationMs: closedMs - startedMs });
  }
  return samples.sort((a, b) => b.closedMs - a.closedMs || b.issue.id - a.issue.id).slice(0, MAX_HISTORY_SAMPLES);
}

/** First millisecond after a currently included closure leaves the inclusive rolling window. */
export function nextHistoryExpiry(issues: Issue[], now: number, options: EstimateOptions = {}): number | null {
  const samples = historySamples(issues, now, options);
  if (!samples.length) return null;
  return Math.min(...samples.map(sample => sample.closedMs + (options.windowDays ?? ESTIMATE_WINDOW_DAYS) * DAY_MS + 1));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Median sample duration, or null with fewer than `MIN_SAMPLES` samples. */
export function typicalDuration(samples: HistorySample[]): number | null {
  return samples.length < MIN_SAMPLES ? null : median(samples.map((s) => s.durationMs));
}

/**
 * Time-weighted average number of concurrent in-progress issues while any was in progress,
 * within the window ending at `now`. Intervals are history samples and current in-progress
 * issues with a known start (running until `now`). At least 1.
 */
export function parallelism(
  samples: HistorySample[],
  inProgress: Issue[],
  now: number,
  windowDays = ESTIMATE_WINDOW_DAYS,
): number {
  const windowStart = now - windowDays * DAY_MS;
  const intervals: [number, number][] = [];
  const add = (start: number, end: number) => {
    const from = Math.max(start, windowStart), to = Math.min(end, now);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) intervals.push([from, to]);
  };
  for (const sample of samples) add(sample.startedMs, sample.closedMs);
  for (const issue of inProgress) add(time(issue.startedAt), now);
  if (!intervals.length) return 1;
  intervals.sort((a, b) => a[0] - b[0]);
  let busy = 0, total = 0, [from, to] = intervals[0]!;
  for (const [start, end] of intervals) {
    total += end - start;
    if (start > to) { busy += to - from; from = start; to = end; } else to = Math.max(to, end);
  }
  busy += to - from;
  return Math.max(1, total / busy);
}

/** Estimate for one repository's already filtered lane issues. */
export function repositoryEstimate(
  issues: Issue[],
  now: number,
  options: EstimateOptions = {},
): RepositoryEstimate {
  const { rules = {}, windowDays = ESTIMATE_WINDOW_DAYS } = options;
  const list = issuesOf(issues);
  const samples = historySamples(list, now, options);
  const typicalMs = typicalDuration(samples);
  const msPerPoint = samples.length < MIN_SAMPLES ? null : median(samples.map(sample => sample.durationMs / approximatePoints(sample.issue)));
  const active = list.filter((issue) => column(issue, rules) === "progress");
  const waiting = list.filter((issue) => column(issue, rules) === "backlog");
  const waitingPoints = waiting.reduce((sum, issue) => sum + approximatePoints(issue), 0);
  const basis: EstimateBasis = {
    samples: samples.length,
    typicalMs,
    msPerPoint,
    windowDays,
    parallelism: parallelism(samples, active, now, windowDays),
  };
  if (msPerPoint === null) return { basis, progress: null, backlog: null };
  const items = active.map((issue): ProgressItemEstimate => {
    const points = approximatePoints(issue), durationMs = points * msPerPoint;
    const started = time(issue.startedAt);
    if (!Number.isFinite(started)) return { issue, points, remainingMs: durationMs, overdue: false, unknownStart: true };
    const left = durationMs - Math.max(0, now - started);
    return { issue, points, remainingMs: Math.max(0, left), overdue: left < 0, unknownStart: false };
  });
  const progressMs = items.reduce((longest, item) => Math.max(longest, item.remainingMs), 0);
  return {
    basis,
    progress: items.length
      ? {
          count: items.length,
          points: items.reduce((sum, item) => sum + item.points, 0),
          remainingMs: progressMs,
          overdue: items.filter((item) => item.overdue).length,
          unknownStart: items.filter((item) => item.unknownStart).length,
          items,
        }
      : null,
    backlog: waiting.length
      ? { count: waiting.length, points: waitingPoints, remainingMs: progressMs + (waitingPoints * msPerPoint) / basis.parallelism }
      : null,
  };
}

/** Combined board: repositories work in parallel, so each column takes the slowest repository. */
export function combinedEstimate(estimates: RepositoryEstimate[]): CombinedEstimate | null {
  const known = estimates.filter((estimate) => estimate.basis.typicalMs !== null);
  if (!known.length) return null;
  const progress = known.flatMap((e) => (e.progress ? [e.progress] : []));
  const backlog = known.flatMap((e) => (e.backlog ? [e.backlog] : []));
  return {
    repositories: known.length,
    samples: known.reduce((sum, e) => sum + e.basis.samples, 0),
    windowDays: Math.max(...known.map((e) => e.basis.windowDays)),
    progress: progress.length
      ? {
          count: progress.reduce((sum, p) => sum + p.count, 0),
          points: progress.reduce((sum, p) => sum + p.points, 0),
          remainingMs: Math.max(...progress.map((p) => p.remainingMs)),
          overdue: progress.reduce((sum, p) => sum + p.overdue, 0),
        }
      : null,
    backlog: backlog.length
      ? {
          count: backlog.reduce((sum, b) => sum + b.count, 0),
          points: backlog.reduce((sum, b) => sum + b.points, 0),
          remainingMs: Math.max(...backlog.map((b) => b.remainingMs)),
        }
      : null,
  };
}

/** Compact approximate duration such as "≈ 25 min", "≈ 3 h 10 min" or "≈ 2 d 4 h". */
export function estimateLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return t("< 1 min");
  if (minutes < 60) return t("≈ {minutes} min", { minutes });
  const hours = Math.round(ms / 3600000);
  if (minutes < 24 * 60) {
    const whole = Math.floor(minutes / 60), rest = minutes % 60;
    return rest ? t("≈ {hours} h {minutes} min", { hours: whole, minutes: rest }) : t("≈ {hours} h", { hours: whole });
  }
  const days = Math.floor(hours / 24), restHours = hours % 24;
  return restHours ? t("≈ {days} d {hours} h", { days, hours: restHours }) : t("≈ {days} d", { days });
}
