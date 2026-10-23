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
 * - Calibration: discard durations per point above 4× the raw sample median, then use the
 *   retained median per repository; fewer than MIN_SAMPLES retained gives no estimate.
 * - In progress: max(0, points × calibrated time per point − spent). The longest remaining item
 *   decides. Past-due items count as zero (never negative) and unknown starts need their full
 *   point-based duration.
 * - Sub-issues (#279): an open parent in the estimated issues forms a group with its sub-issues
 *   (recursively, when `children` is supplied). The group is one item sized by the parent's points:
 *   spent = the parent's own in-progress time + Σ each descendant's spent time, where a running
 *   descendant counts now − its start and a closed descendant counts its positive start → close
 *   interval when closed within the window; backlog or unknown descendants count zero. So
 *   remaining = max(0, parent estimate − parent elapsed − Σ descendant spent). Descendants that
 *   are themselves open estimated issues are absorbed into the group and never count as separate
 *   items or backlog points, so neither their remaining nor their spent time is counted twice.
 *   A group is in progress when the parent or any open descendant is in progress; otherwise it
 *   stays in the backlog with its spent time deducted from its backlog points. History calibration is
 *   unchanged. The parent's own card/row forecast (issueGroupEstimate, #281) applies the same rule
 *   to its own subtree once its sub-issues are loaded, and the overview story points count each
 *   group once, by its root's points, in the column the group is estimated in.
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
export const EXTREME_DURATION_MULTIPLIER = 4;
const DAY_MS = 86400000;

export interface HistorySample {
  issue: Issue;
  startedMs: number;
  closedMs: number;
  durationMs: number;
}
export interface EstimateBasis {
  /** Number of retained recent closures after extreme-duration filtering, capped at MAX_HISTORY_SAMPLES. */
  samples: number;
  /** Median retained duration for existing consumers; forecasts use msPerPoint. */
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
  /** Time already spent on the parent's sub-issues and deducted from this item (#279). */
  subIssueSpentMs: number;
  /** Sub-issues whose spent time was examined for this item. */
  subIssues: number;
  /** Whether the remaining time is currently decreasing with the clock. */
  counting: boolean;
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
/** A direct sub-issue, with its own repository's rules for column classification. */
export interface SubIssueWork { issue: Issue; rules?: Rules }
export interface EstimateOptions {
  rules?: Rules;
  /** Direct sub-issues per parent issue id, for deducting sub-issue time from the parent (#279). */
  children?: ReadonlyMap<number, readonly SubIssueWork[]>;
  windowDays?: number;
  sampleLimit?: number;
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);
const issuesOf = (issues: Issue[]) => issues.filter((issue) => !issue.pull_request);

/** Most recent eligible closures in the rolling window, capped before calibration and concurrency. */
export function historySamples(
  issues: Issue[],
  now: number,
  { rules = {}, windowDays = ESTIMATE_WINDOW_DAYS, sampleLimit = MAX_HISTORY_SAMPLES }: EstimateOptions = {},
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
  return samples.sort((a, b) => b.closedMs - a.closedMs || b.issue.id - a.issue.id).slice(0, sampleLimit);
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

/**
 * Suspected interrupted runs must not teach future forecasts or historical concurrency.
 * Normalize by size before comparing: a large issue taking proportionately longer is valid.
 * Use one robust median of the raw window; do not iteratively trim legitimate slow work.
 */
export function calibrationSamples(samples: HistorySample[]): HistorySample[] {
  if (samples.length < MIN_SAMPLES) return samples;
  const rates = samples.map(sample => sample.durationMs / approximatePoints(sample.issue));
  const center = median(rates)!;
  return samples.filter((_, index) => rates[index]! <= center * EXTREME_DURATION_MULTIPLIER);
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
  const samples = calibrationSamples(historySamples(list, now, options));
  const typicalMs = typicalDuration(samples);
  const msPerPoint = samples.length < MIN_SAMPLES ? null : median(samples.map(sample => sample.durationMs / approximatePoints(sample.issue)));
  const active = list.filter((issue) => column(issue, rules) === "progress");
  const waiting = list.filter((issue) => column(issue, rules) === "backlog");
  const basis: EstimateBasis = {
    samples: samples.length,
    typicalMs,
    msPerPoint,
    windowDays,
    parallelism: parallelism(samples, active, now, windowDays),
  };
  if (msPerPoint === null) return { basis, progress: null, backlog: null };
  const groups = subIssueGroups([...active, ...waiting], now, rules, windowDays, options.children);
  const items = groups.filter(group => group.inProgress).map(({ root: issue, ownProgress, spentMs, running, descendants }): ProgressItemEstimate => {
    const points = approximatePoints(issue), durationMs = points * msPerPoint;
    const started = time(issue.startedAt);
    const unknownStart = ownProgress && !Number.isFinite(started);
    const ownMs = ownProgress && Number.isFinite(started) ? Math.max(0, now - started) : 0;
    const left = durationMs - ownMs - spentMs;
    const ownRunning = ownProgress && Number.isFinite(started) && started <= now;
    return { issue, points, remainingMs: Math.max(0, left), overdue: left < 0, unknownStart,
      subIssueSpentMs: spentMs, subIssues: descendants, counting: left > 0 && (ownRunning || running) };
  });
  const backlogGroups = groups.filter(group => !group.inProgress);
  const waitingPoints = backlogGroups.reduce((sum, group) => sum + Math.max(0, approximatePoints(group.root) - group.spentMs / msPerPoint), 0);
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
    // The Backlog column is done when its own remaining roots and any promoted parent groups are done.
    backlog: waiting.length
      ? { count: waiting.length, points: backlogGroups.reduce((sum, group) => sum + approximatePoints(group.root), 0),
          remainingMs: progressMs + (waitingPoints * msPerPoint) / basis.parallelism }
      : null,
  };
}

/** Time already spent on one sub-issue: running time, or a closed interval inside the window. */
export function subIssueSpentMs(child: SubIssueWork, fallbackRules: Rules, now: number, windowDays = ESTIMATE_WINDOW_DAYS) {
  const { issue } = child, state = column(issue, child.rules ?? fallbackRules);
  if (issue.pull_request) return { spentMs: 0, running: false, open: false };
  if (state === "progress") {
    const start = time(issue.startedAt);
    const running = Number.isFinite(start) && start <= now;
    return { spentMs: running ? now - start : 0, running, open: true };
  }
  if (state === "closed") {
    const start = time(issue.workStartedAt ?? issue.startedAt), end = time(issue.closed_at);
    const valid = Number.isFinite(start) && Number.isFinite(end) && end > start && end <= now && end >= now - windowDays * DAY_MS;
    return { spentMs: valid ? end - start : 0, running: false, open: false };
  }
  return { spentMs: 0, running: false, open: issue.state === "open" };
}

export interface SubIssueGroup { root: Issue; ownProgress: boolean; inProgress: boolean; spentMs: number; running: boolean; descendants: number }
/** Sub-issue work below one root: Σ descendant spent time, whether one runs, their count and open progress. */
export interface SubIssueGroupWork { spentMs: number; running: boolean; descendants: number; openInProgress: boolean }

/**
 * Walks one root's descendants (deduplicated by id, cycle-safe) and adds each one's spent time
 * exactly once. `members` are the open estimated board issues, preferred for start times and rules.
 */
export function subIssueGroupWork(root: Issue, members: ReadonlyMap<number, Issue>, now: number, rules: Rules,
  windowDays: number, children: ReadonlyMap<number, readonly SubIssueWork[]> | undefined): SubIssueGroupWork {
  const work: SubIssueGroupWork = { spentMs: 0, running: false, descendants: 0, openInProgress: false };
  const seen = new Set([root.id]);
  const walk = (id: number) => {
    for (const child of children?.get(id) ?? []) {
      if (seen.has(child.issue.id)) continue;
      seen.add(child.issue.id);
      // Prefer the estimated board copy, which carries start times and the group's rules.
      const member = members.get(child.issue.id);
      const entry = member ? { issue: member, rules: child.rules ?? rules } : child;
      const spent = subIssueSpentMs(entry, rules, now, windowDays);
      work.descendants++;
      work.spentMs += spent.spentMs;
      work.running ||= spent.running;
      if (spent.open && column(entry.issue, entry.rules ?? rules) === "progress") work.openInProgress = true;
      walk(child.issue.id);
    }
  };
  walk(root.id);
  return work;
}

/** Open estimated issues of one repository, grouped exactly as the column estimates group them. */
export function estimateGroups(issues: Issue[], now: number, options: EstimateOptions = {}): SubIssueGroup[] {
  const { rules = {}, windowDays = ESTIMATE_WINDOW_DAYS } = options;
  const list = issuesOf(issues);
  const open = [...list.filter(issue => column(issue, rules) === "progress"), ...list.filter(issue => column(issue, rules) === "backlog")];
  return subIssueGroups(open, now, rules, windowDays, options.children);
}

/**
 * Groups open estimated issues under their topmost open estimated ancestor. Each descendant
 * (deduplicated by id, cycle-safe) adds its spent time exactly once to that root.
 */
function subIssueGroups(open: Issue[], now: number, rules: Rules, windowDays: number,
  children: ReadonlyMap<number, readonly SubIssueWork[]> | undefined): SubIssueGroup[] {
  const members = new Map(open.map(issue => [issue.id, issue]));
  const absorbed = new Set<number>();
  if (children) for (const issue of open) for (const child of children.get(issue.id) ?? [])
    if (child.issue.id !== issue.id && members.has(child.issue.id)) absorbed.add(child.issue.id);
  // A (malformed) cycle of absorbed members would lose them all; keep such issues as their own roots.
  const reachable = new Set<number>();
  const visit = (id: number, seen: Set<number>) => {
    for (const child of children?.get(id) ?? []) if (!seen.has(child.issue.id)) { seen.add(child.issue.id); visit(child.issue.id, seen); }
  };
  for (const issue of open) if (!absorbed.has(issue.id)) visit(issue.id, reachable);
  return open.filter(issue => !absorbed.has(issue.id) || !reachable.has(issue.id)).map(root => {
    const ownProgress = column(root, rules) === "progress";
    const work = subIssueGroupWork(root, members, now, rules, windowDays, children);
    return { root, ownProgress, inProgress: ownProgress || work.openInProgress, spentMs: work.spentMs, running: work.running, descendants: work.descendants };
  });
}

/** Individual forecast uses the same calibrated rate and size as column estimates. */
export function issueEstimate(issue: Issue, msPerPoint: number | null | undefined, now: number, inProgress: boolean) {
  if (msPerPoint == null || !Number.isFinite(msPerPoint) || msPerPoint <= 0) return null;
  const totalMs = approximatePoints(issue) * msPerPoint;
  const start = time(issue.startedAt);
  // Unknown or future starts cannot justify a remaining-time countdown.
  if (!inProgress || !Number.isFinite(start) || start > now) return { totalMs, remainingMs: null, overdue: false };
  const remaining = totalMs - (now - start);
  return { totalMs, remainingMs: Math.max(0, remaining), overdue: remaining < 0 };
}

export interface IssueGroupForecast {
  totalMs: number;
  /** Remaining time for the issue's group; null when nothing justifies a countdown. */
  remainingMs: number | null;
  overdue: boolean;
  /** Time over the estimate when overdue, otherwise 0. */
  overtimeMs: number;
  /** The issue's own deducted in-progress time. */
  ownSpentMs: number;
  /** Time spent on its sub-issues and deducted from its estimate (#281). */
  subIssueSpentMs: number;
  subIssues: number;
  /** Whether the issue itself or one of its sub-issues is running, so spent time grows. */
  running: boolean;
  /** Whether the remaining time is decreasing with the clock (or about to turn overdue). */
  counting: boolean;
}

/**
 * Per-card forecast with the column estimate's sub-issue group rule (#281): remaining =
 * max(0, estimate − own elapsed − Σ sub-issue spent). Without `group` (sub-issues not loaded,
 * or none) it equals issueEstimate. A backlog parent gets a countdown only once sub-issue work
 * has started, matching its group moving into the In progress badge.
 */
export function issueGroupEstimate(issue: Issue, msPerPoint: number | null | undefined, now: number, inProgress: boolean,
  group?: SubIssueGroupWork | null): IssueGroupForecast | null {
  const base = issueEstimate(issue, msPerPoint, now, inProgress);
  if (!base) return null;
  const subIssueSpentMs = group?.spentMs ?? 0, subIssues = group?.descendants ?? 0, running = !!group?.running;
  const start = time(issue.startedAt);
  const ownRunning = inProgress && Number.isFinite(start) && start <= now;
  const ownSpentMs = ownRunning ? now - start : 0;
  const deducted = subIssueSpentMs > 0 || running || !!group?.openInProgress;
  if (!ownRunning && !deducted) return { ...base, overtimeMs: 0, ownSpentMs, subIssueSpentMs, subIssues, running: false, counting: false };
  const left = base.totalMs - ownSpentMs - subIssueSpentMs;
  return { totalMs: base.totalMs, remainingMs: Math.max(0, left), overdue: left < 0, overtimeMs: Math.max(0, -left),
    ownSpentMs, subIssueSpentMs, subIssues, running: ownRunning || running, counting: left >= 0 && (ownRunning || running) };
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

/** Observed work duration, compared with other recent closures rather than calibrating against itself. */
export function closedIssueOutcome(issue: Issue, history: HistorySample[], now: number) {
  const start = time(issue.workStartedAt ?? issue.startedAt), end = time(issue.closed_at);
  if (issue.pull_request || issue.state !== "closed" || !Number.isFinite(start) || !Number.isFinite(end) || end > now || end <= start) return null;
  return outcomeForActual(issue, end - start, history);
}

/** Closed parent duration: sum complete member intervals, otherwise use one complete group span. */
export function closedIssueGroupOutcome(issue: Issue, children: Issue[], history: HistorySample[], now: number) {
  if (!children.length) return closedIssueOutcome(issue, history, now);
  if (issue.pull_request || issue.state !== "closed") return null;
  const members = [issue, ...children];
  const intervals = members.map(member => {
    const start = time(member.workStartedAt ?? member.startedAt), end = time(member.closed_at);
    return { start, end, validEnd: member.state === "closed" && Number.isFinite(end) && end <= now };
  });
  // Every child must be present and closed for either metric to describe the whole group.
  if (intervals.some(interval => !interval.validEnd)) return null;
  const knownIntervals = intervals.filter(interval => Number.isFinite(interval.start) && interval.start < interval.end);
  let actualMs: number, aggregation: "sum" | "span";
  if (knownIntervals.length === intervals.length) {
    actualMs = knownIntervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
    aggregation = "sum";
  } else {
    const starts = intervals.filter(interval => interval.start < interval.end).map(interval => interval.start).filter(Number.isFinite);
    if (!starts.length) return null;
    actualMs = Math.max(...intervals.map(interval => interval.end)) - Math.min(...starts);
    if (!(actualMs > 0)) return null;
    aggregation = "span";
  }
  const outcome = outcomeForActual(issue, actualMs, history);
  return outcome ? { ...outcome, aggregation } : null;
}

function outcomeForActual(issue: Issue, actualMs: number, history: HistorySample[]) {
  const others = calibrationSamples(history.filter(sample => sample.issue.id !== issue.id).slice(0, MAX_HISTORY_SAMPLES));
  const rate = others.length < MIN_SAMPLES ? null : median(others.map(sample => sample.durationMs / approximatePoints(sample.issue)));
  return { actualMs, estimatedMs: rate === null ? null : rate * approximatePoints(issue) };
}
