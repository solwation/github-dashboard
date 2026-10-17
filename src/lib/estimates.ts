import { t } from "./i18n";
import { column, type Issue, type Rules } from "./model";

/**
 * Pure time estimates for the board (#138). Nothing here fetches data: callers pass the lane
 * issues they already show, after their own filters (hidden coordination, search), plus `now`.
 *
 * Model:
 * - History: closed issues of one repository closed within the last `windowDays` that carry a
 *   `startedAt`. Their duration is startedAt → closed_at. Issues closed without a known start
 *   (never in progress, or the timeline is unknown) are excluded.
 * - Typical time: the median duration, which resists outliers. Fewer than `MIN_SAMPLES` samples
 *   give no estimate.
 * - In progress: each issue has remaining = max(0, typical − elapsed). The column is done when
 *   the longest remaining issue finishes. Issues past the typical time count as 0 and are
 *   reported as `overdue`; issues without a known start are assumed to need the full typical time.
 * - Parallelism: the time-weighted average number of issues in progress while at least one was in
 *   progress, over the window: sum of in-progress durations (history plus current in-progress
 *   issues, clipped to the window) divided by the length of their union. Idle periods such as
 *   nights do not dilute it. Never below 1.
 * - Backlog: in-progress remaining time + backlog count × typical ÷ parallelism, since backlog
 *   work starts when capacity frees up.
 * - Combined board: repositories work independently in parallel, so each column finishes when
 *   the slowest repository finishes (maximum per column). Repositories without an estimate are
 *   skipped.
 */
export const ESTIMATE_WINDOW_DAYS = 30;
export const MIN_SAMPLES = 3;
const DAY_MS = 86400000;

export interface HistorySample {
  issue: Issue;
  startedMs: number;
  closedMs: number;
  durationMs: number;
}
export interface EstimateBasis {
  /** Number of closed issues with a known start in the window. */
  samples: number;
  /** Median duration of those samples, or null with too few samples. */
  typicalMs: number | null;
  windowDays: number;
  /** Average concurrent in-progress issues, at least 1. */
  parallelism: number;
}
export interface ProgressItemEstimate {
  issue: Issue;
  remainingMs: number;
  overdue: boolean;
  /** Start time was unknown; the full typical time is assumed. */
  unknownStart: boolean;
}
export interface ColumnEstimate {
  /** Issues in the column. */
  count: number;
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

/** Closed issues within the window that were in progress, with their in-progress duration. */
export function historySamples(
  issues: Issue[],
  now: number,
  { rules = {}, windowDays = ESTIMATE_WINDOW_DAYS }: EstimateOptions = {},
): HistorySample[] {
  const cutoff = now - windowDays * DAY_MS;
  const samples: HistorySample[] = [];
  for (const issue of issuesOf(issues)) {
    if (column(issue, rules) !== "closed") continue;
    const startedMs = time(issue.startedAt), closedMs = time(issue.closed_at);
    if (!Number.isFinite(startedMs) || !Number.isFinite(closedMs)) continue;
    if (closedMs < cutoff || closedMs > now || closedMs < startedMs) continue;
    samples.push({ issue, startedMs, closedMs, durationMs: closedMs - startedMs });
  }
  return samples;
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
  const active = list.filter((issue) => column(issue, rules) === "progress");
  const waiting = list.filter((issue) => column(issue, rules) === "backlog").length;
  const basis: EstimateBasis = {
    samples: samples.length,
    typicalMs,
    windowDays,
    parallelism: parallelism(samples, active, now, windowDays),
  };
  if (typicalMs === null) return { basis, progress: null, backlog: null };
  const items = active.map((issue): ProgressItemEstimate => {
    const started = time(issue.startedAt);
    if (!Number.isFinite(started)) return { issue, remainingMs: typicalMs, overdue: false, unknownStart: true };
    const left = typicalMs - Math.max(0, now - started);
    return { issue, remainingMs: Math.max(0, left), overdue: left < 0, unknownStart: false };
  });
  const progressMs = items.reduce((longest, item) => Math.max(longest, item.remainingMs), 0);
  return {
    basis,
    progress: items.length
      ? {
          count: items.length,
          remainingMs: progressMs,
          overdue: items.filter((item) => item.overdue).length,
          unknownStart: items.filter((item) => item.unknownStart).length,
          items,
        }
      : null,
    backlog: waiting
      ? { count: waiting, remainingMs: progressMs + (waiting * typicalMs) / basis.parallelism }
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
          remainingMs: Math.max(...progress.map((p) => p.remainingMs)),
          overdue: progress.reduce((sum, p) => sum + p.overdue, 0),
        }
      : null,
    backlog: backlog.length
      ? {
          count: backlog.reduce((sum, b) => sum + b.count, 0),
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
