import {
  closedIssueOutcome, ESTIMATE_WINDOW_DAYS, historySamples, MAX_HISTORY_SAMPLES, repositoryEstimate, median,
} from "./estimates";
import { closedWorkStart, type Issue, type Rules } from "./model";
import { approximatePoints, validPoints, type ApproximatePoints } from "./story-points";
import type { StatisticsData, StatisticsEvent, StatisticsIssue } from "./statistics";

/**
 * Historical estimate metrics for Statistics (#280). Pure: callers pass collected snapshots.
 *
 * Both metrics reuse the board's estimate code in estimates.ts instead of a second model:
 * - Time per story point (`timePerPoint`, hours): the `msPerPoint` that `repositoryEstimate`
 *   would have calibrated at the end of each chart bucket (clamped to now), from the closings
 *   known at that moment: rolling ESTIMATE_WINDOW_DAYS window, at most MAX_HISTORY_SAMPLES most
 *   recent closings, extreme-duration filter and median per point. Its total is the latest
 *   defined bucket value in the period.
 * - Estimate deviation (`estimateDeviation`, %): for every closing in a bucket,
 *   `closedIssueOutcome` compares the actual start → close duration with the estimate from the
 *   other closings known at that closing time (the issue never calibrates itself).
 *   Deviation = median(actual ÷ estimated − 1) × 100, so +25 means work took 25 % longer than
 *   estimated, −25 % shorter and 0 % exactly as estimated. The total is the median over every
 *   closing in the period.
 *
 * Sources: closings and work starts come from the repository issue events Statistics already
 * collects (closed/reopened/labeled/unlabeled), with the work start derived like the board's
 * closed-issue work start (#141). Story points are the local `approximatePoints` score; cached
 * snapshots keep only that number, never titles or bodies. A closing counts in the history at T
 * while the issue was not reopened again by T. Label/contributor filters select the closings
 * (current issue labels, closing actor), matching the closed-issues metric.
 *
 * Completeness: events cover the collection window only. An evaluation whose 30-day lookback
 * starts before that window is partial unless MAX_HISTORY_SAMPLES newer closings already decide it.
 */
const DAY_MS = 86_400_000;

/** Approximate story points for a statistics issue: a stored score, or computed from live title/body. */
export function statisticsIssuePoints(issue: StatisticsIssue | undefined): ApproximatePoints | null {
  if (!issue) return null;
  if (typeof issue.points === "number" && validPoints(issue.points)) return issue.points as ApproximatePoints;
  if (typeof issue.title !== "string") return null;
  return approximatePoints({ title: issue.title, body: typeof issue.body === "string" ? issue.body : null, labels: issue.labels as Issue["labels"] });
}

export interface StatisticsClosing {
  /** Synthetic closed board issue whose only label encodes the points, so estimates.ts sizes it identically. */
  issue: Issue;
  labels: { name: string }[];
  closer: string;
  closedMs: number;
  startedMs: number;
  /** First reopening after this closing, or Infinity. */
  reopenedMs: number;
}

/** Every closing with a known work start and size, oldest first. */
export function statisticsClosings(snapshot: StatisticsData, rules: Rules = {}): StatisticsClosing[] {
  if (!snapshot.events) return [];
  const byIssue = new Map<number, StatisticsEvent[]>();
  for (const event of snapshot.events.data) {
    const id = event.issue?.id;
    if (id === undefined || event.issue!.pull_request || typeof event.created_at !== "string") continue;
    (byIssue.get(id) ?? byIssue.set(id, []).get(id)!).push(event);
  }
  const issues = new Map((snapshot.issues?.data || []).map(issue => [issue.id, issue]));
  const closings: StatisticsClosing[] = [];
  for (const [id, events] of byIssue) {
    const sorted = [...events].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
    const embedded = sorted.find(event => event.issue)!.issue!;
    const points = statisticsIssuePoints(issues.get(id)) ?? sorted.map(event => statisticsIssuePoints(event.issue)).find(value => value !== null) ?? null;
    if (points === null) continue;
    for (const [index, event] of sorted.entries()) {
      if (event.event !== "closed") continue;
      const closedMs = Date.parse(event.created_at);
      const start = closedWorkStart(sorted, event.created_at, rules);
      const startedMs = start ? Date.parse(start) : NaN;
      if (!Number.isFinite(closedMs) || !Number.isFinite(startedMs) || startedMs >= closedMs) continue;
      const reopened = sorted.slice(index + 1).find(next => next.event === "reopened" && Date.parse(next.created_at) >= closedMs);
      closings.push({
        issue: {
          id, number: embedded.number, title: "", body: null, html_url: "", state: "closed",
          created_at: embedded.created_at, updated_at: event.created_at, closed_at: event.created_at,
          labels: [{ name: `sp ${points}`, color: "" }], assignees: [], workStartedAt: start!,
        },
        labels: (issues.get(id) ?? embedded).labels,
        closer: event.actor?.login ?? "",
        closedMs, startedMs,
        reopenedMs: reopened ? Date.parse(reopened.created_at) : Infinity,
      });
    }
  }
  return closings.sort((a, b) => a.closedMs - b.closedMs || a.issue.id - b.issue.id);
}

/** Closed issues as the board would have listed them at `at`. */
function knownAt(closings: StatisticsClosing[], at: number) {
  return closings.filter(closing => closing.closedMs <= at && closing.reopenedMs > at).map(closing => closing.issue);
}
/** True when the evaluation at `at` cannot depend on events before the collection window. */
function decided(closings: StatisticsClosing[], at: number, collectionStart: number, sampleLimit = MAX_HISTORY_SAMPLES) {
  return at - ESTIMATE_WINDOW_DAYS * DAY_MS >= collectionStart || historySamples(knownAt(closings, at), at, { sampleLimit }).length >= sampleLimit;
}

/** The board's calibrated milliseconds per point at `at`, or null without a basis. */
export function msPerPointAt(closings: StatisticsClosing[], at: number): number | null {
  return repositoryEstimate(knownAt(closings, at), at).basis.msPerPoint;
}

/** actual ÷ estimated − 1 for one closing, using the history known when it closed; null without a basis. */
export function closingDeviation(closings: StatisticsClosing[], closing: StatisticsClosing): number | null {
  const at = closing.closedMs;
  const history = historySamples(knownAt(closings, at), at, { sampleLimit: MAX_HISTORY_SAMPLES + 1 });
  const outcome = closedIssueOutcome(closing.issue, history, at);
  return outcome?.estimatedMs ? outcome.actualMs / outcome.estimatedMs - 1 : null;
}

export interface EstimateBucket { start: number; end: number }
export interface EstimateMetrics {
  /** Hours per point per bucket (undefined = no basis). */
  timePerPoint: (number | undefined)[];
  /** Deviation percent per bucket (undefined = no closing with an estimate). */
  estimateDeviation: (number | undefined)[];
  totals: { timePerPoint?: number; estimateDeviation?: number };
  complete: { timePerPoint: boolean; estimateDeviation: boolean };
}
const hours = (ms: number) => Math.round(ms / 36_000) / 100;
const percent = (ratio: number) => Math.round(ratio * 100) || 0; // never -0

/**
 * Evaluates both metrics for buckets of one or more snapshots. `bucketOf` maps a closing time to
 * a bucket index (or -1 outside the window). Time per point needs exactly one repository, since
 * calibrations of different repositories are not comparable; deviations are pooled.
 */
export function statisticsEstimateMetrics(
  data: StatisticsData[], buckets: EstimateBucket[], bucketOf: (time: number) => number,
  options: { now: number; rules?: Record<string, Rules>; matches?: (closing: StatisticsClosing) => boolean },
): EstimateMetrics {
  const result: EstimateMetrics = { timePerPoint: buckets.map(() => undefined), estimateDeviation: buckets.map(() => undefined), totals: {}, complete: { timePerPoint: true, estimateDeviation: true } };
  const ratios = buckets.map(() => [] as number[]), all: number[] = [];
  for (const snapshot of data) {
    if (!snapshot.events) continue;
    const closings = statisticsClosings(snapshot, options.rules?.[snapshot.repository] ?? {}).filter(options.matches ?? (() => true));
    const collectionStart = Date.parse(`${snapshot.from}T00:00:00Z`);
    const complete = (at: number, limit?: number) => snapshot.events!.complete && decided(closings, at, collectionStart, limit);
    if (data.length === 1) {
      buckets.forEach((bucket, index) => {
        if (bucket.start > options.now) return;
        const at = Math.min(bucket.end, options.now), value = msPerPointAt(closings, at);
        if (value === null) return;
        result.timePerPoint[index] = hours(value);
        result.complete.timePerPoint &&= complete(at);
      });
    }
    for (const closing of closings) {
      const index = bucketOf(closing.closedMs);
      if (index < 0) continue;
      const ratio = closingDeviation(closings, closing);
      if (ratio === null) continue;
      ratios[index]!.push(ratio); all.push(ratio);
      result.complete.estimateDeviation &&= complete(closing.closedMs, MAX_HISTORY_SAMPLES + 1);
    }
  }
  ratios.forEach((values, index) => { if (values.length) result.estimateDeviation[index] = percent(median(values)!); });
  for (const value of result.timePerPoint) if (value !== undefined) result.totals.timePerPoint = value;
  if (all.length) result.totals.estimateDeviation = percent(median(all)!);
  return result;
}
