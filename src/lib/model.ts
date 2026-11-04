import { t } from "./i18n";
export interface Label {
  name: string;
  color: string;
}
export interface IssueComment {
  id: number;
  body: string | null;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
}
export interface Issue {
  id: number;
  number: number;
  title: string;
  body?: string | null;
  comments?: number;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: Label[];
  assignees: { login: string; avatar_url: string }[];
  pull_request?: unknown;
  sub_issues_summary?: { total: number; completed: number; percent_completed?: number };
  startedAt?: string | null;
  timerError?: boolean;
  /**
   * Local enrichment for closed issues only (#141): when the last in-progress period before closing
   * started. Kept from the in-progress `startedAt` when sync sees the issue close, or derived from
   * already fetched repository events. Separate from `startedAt` so timers, timeouts and closure
   * feedback never treat a closed issue as running. Absent when unknown.
   */
  workStartedAt?: string;
  /**
   * Local enrichment (#392): milliseconds of the current In progress period (open issues) or of the
   * closing work period (closed issues) that only waited for integration (`integration-ready`
   * without an active work label). Waiting is not active work, so timers, timeouts and estimates
   * subtract it. Absent means none was recorded.
   */
  waitMs?: number;
  /** Open issues only (#392): start of the current integration wait, null or absent when not waiting. */
  waitingSince?: string | null;
  /**
   * Board overlay only (#381): the issue left In progress but GitHub has not confirmed its
   * closing yet. Never part of the issues held in `lanes` or the encrypted content cache.
   */
  pendingClosure?: boolean;
}
export interface Repo {
  /** Safe raster artwork/negative result, persisted only in encrypted account content. */
  projectIcon?: import("./project-icon").ProjectIconMetadata;
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  /** GitHub Pages enabled; absent when the API data does not say. */
  has_pages?: boolean;
  html_url: string;
  owner: { login: string };
  language?: string | null;
}
export interface Lane {
  /** A newly selected repository has no issue snapshot until its first read finishes. */
  loading?: boolean;
  repo: Repo;
  issues: Issue[];
  labels: Label[];
  error?: string;
  timerWarning?: boolean;
}
export interface Rules {
  progress?: string;
  high?: string;
  medium?: string;
  low?: string;
}
export interface Event {
  id: number;
  event: string;
  created_at: string;
  label?: { name: string };
}
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[\s_:-]+/g, " ");
export function isProgress(label: string, rules: Rules = {}) {
  return rules.progress
    ? label.toLowerCase() === rules.progress.toLowerCase().trim()
    : [
        "in progress",
        "status in progress",
        "wip",
        "working",
        "doing",
        "pågår",
      ].includes(normalize(label));
}
/**
 * Built-in "waiting for integration" status (#392): finished work handed off for integration. It is
 * a separate status, so a repository's custom work label (which replaces the active-work labels)
 * does not replace it. It keeps an open issue in In progress but is never active work.
 */
export const isIntegrationReady = (label: string) => normalize(label) === "integration ready";
/** Any label that places an open issue in In progress: active work or waiting for integration. */
export const isWorkLabel = (label: string, rules: Rules = {}) => isProgress(label, rules) || isIntegrationReady(label);
/** Open and actively worked on; when both labels are present, active work wins (#392). */
export const isActiveWork = (issue: Issue, rules: Rules = {}) =>
  issue.state !== "closed" && issue.labels.some((l) => isProgress(l.name, rules));
/** Open, in In progress only because it waits for integration (#392). */
export const awaitsIntegration = (issue: Issue, rules: Rules = {}) =>
  issue.state !== "closed" && !isActiveWork(issue, rules) && issue.labels.some((l) => isIntegrationReady(l.name));
// Work labels are redundant in the In progress column (integration-ready has its own indicator,
// #392) and misleading on closed issues (#264).
export const hidesWorkLabel = (col: string, label: string, rules: Rules = {}) =>
  col === "closed" ? isWorkLabel(label, rules) : col === "progress" && isWorkLabel(label, rules);
export function priority(issue: Issue, rules: Rules = {}): number {
  const names = issue.labels.map((l) => normalize(l.name));
  for (const [rank, level] of ["high", "medium", "low"].entries()) {
    if (
      rules[level as keyof Rules] &&
      names.includes(normalize(rules[level as keyof Rules]!))
    )
      return rank;
  }
  if (
    names.some(
      (n) =>
        /^(priority )?(critical|urgent|high)( priority)?$/.test(n) ||
        /^(p0|p1|priority p0|priority p1)$/.test(n),
    )
  )
    return 0;
  if (
    names.some(
      (n) =>
        /^(priority )?medium( priority)?$/.test(n) ||
        n === "p2" ||
        n === "priority p2",
    )
  )
    return 1;
  if (
    names.some(
      (n) =>
        /^(priority )?low( priority)?$/.test(n) ||
        ["p3", "p4", "priority p3", "priority p4", "reviewer filed"].includes(
          n,
        ),
    )
  )
    return 2;
  return 1;
}
export function isCoordination(issue: Issue) {
  return issue.labels.some((l) =>
    ["agent coordination", "orkester"].includes(normalize(l.name)),
  );
}
export function column(issue: Issue, rules: Rules = {}) {
  return issue.state === "closed"
    ? "closed"
    : issue.labels.some((l) => isWorkLabel(l.name, rules))
      ? "progress"
      : "backlog";
}
/** Sort choices per column (#286); "default" is the board's original order. */
export type ColumnSort = "default" | "lowest" | "oldest" | "newest" | "recent" | "priority";
export const COLUMN_SORT_OPTIONS: Record<string, ColumnSort[]> = {
  backlog: ["default", "lowest", "oldest", "newest"],
  progress: ["default", "recent", "priority"],
  closed: ["default", "oldest", "priority"],
};
export function validColumnSort(col: string, value: unknown): ColumnSort {
  return (COLUMN_SORT_OPTIONS[col] as unknown[] | undefined)?.includes(value) ? (value as ColumnSort) : "default";
}
const time = (value: string | null | undefined) => Date.parse(value as string);
/** Compares two issues of one column; each issue is ranked by its own repository's rules. */
export function compareColumnIssues(col: string, sort: ColumnSort, a: Issue, b: Issue, rulesA: Rules = {}, rulesB: Rules = rulesA) {
  const prio = priority(a, rulesA) - priority(b, rulesB);
  const created = time(a.created_at) - time(b.created_at);
  const started = time(a.startedAt || a.created_at) - time(b.startedAt || b.created_at);
  const closed = time(b.closed_at) - time(a.closed_at);
  if (col === "closed")
    return sort === "oldest" ? -closed : sort === "priority" ? prio || closed : closed;
  if (col === "backlog")
    // Lowest first is the exact reverse of the default, so the bottom of the Backlog comes first.
    return sort === "lowest" ? -(prio || created) : sort === "oldest" ? created : sort === "newest" ? -created : prio || created;
  return sort === "recent" ? -started : sort === "priority" ? prio || started : started;
}
export function sortedIssues(issues: Issue[], col: string, rules: Rules = {}, sort: ColumnSort = "default") {
  return issues
    .filter((i) => !i.pull_request && column(i, rules) === col)
    .sort((a, b) => compareColumnIssues(col, sort, a, b, rules));
}
/**
 * A finished handoff that removes one work label and adds the other a moment later (two separate
 * label edits) still continues the same In progress period (#392).
 */
export const WORK_HANDOFF_GRACE_MS = 5 * 60_000;
/** Current In progress period from label events (#392). */
export interface ProgressPeriod {
  /** Start of the continuous active/integration-ready chain, so the card does not jump on handoff. */
  start: string | null;
  /** Completed integration waits inside that period. */
  waitMs: number;
  /** Start of the current wait while only integration-ready is active. */
  waitingSince: string | null;
}
type WorkKind = "active" | "waiting";
const byTime = (events: Event[]) => [...events].sort(
  (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
/**
 * Replays label events into work periods. Each still-present work label keeps an effective start:
 * its own addition, except that switching between active work and integration-ready (while the
 * other is present, or within the handoff grace after it was removed) inherits the period's start.
 * Plain active labels therefore keep the original rule: earliest still-active addition.
 */
function replayWork(events: Event[], rules: Rules, until = Infinity, clearOnClose = true) {
  const kind = (name: string): WorkKind | null => isProgress(name, rules) ? "active" : isIntegrationReady(name) ? "waiting" : null;
  const starts = new Map<string, { at: string; kind: WorkKind }>();
  let waitMs = 0, waitingSince: number | null = null, period: string | null = null;
  let ended: { start: string; at: number; kind: WorkKind } | null = null;
  const first = () => [...starts.values()].map((v) => v.at).sort()[0] ?? null;
  const onlyWaiting = () => starts.size > 0 && [...starts.values()].every((v) => v.kind === "waiting");
  const reset = () => { starts.clear(); waitMs = 0; waitingSince = null; period = null; ended = null; };
  const settle = (at: number) => {
    // Track integration waits as intervals where every present work label is integration-ready.
    if (onlyWaiting()) waitingSince ??= at;
    else if (waitingSince !== null) { waitMs += Math.max(0, at - waitingSince); waitingSince = null; }
  };
  for (const e of byTime(events)) {
    const at = Date.parse(e.created_at);
    if (!Number.isFinite(at)) continue;
    if (at > until) break;
    if (e.event === "reopened" || (clearOnClose && e.event === "closed")) { reset(); continue; }
    const k = e.label ? kind(e.label.name) : null;
    if (!k || !e.label) continue;
    if (e.event === "labeled") {
      let effective = e.created_at;
      if (starts.size) {
        if ([...starts.values()].some((v) => v.kind !== k)) effective = first() ?? effective;
      } else if (ended && ended.kind !== k && at - ended.at <= WORK_HANDOFF_GRACE_MS) {
        effective = ended.start;
      } else { waitMs = 0; waitingSince = null; }
      starts.set(e.label.name, { at: effective, kind: k });
      period = first();
      ended = null;
    } else if (e.event === "unlabeled" && starts.has(e.label.name)) {
      const start = first()!;
      starts.delete(e.label.name);
      if (!starts.size) {
        // Wait ends with the period; a quick handoff can still continue it.
        if (waitingSince !== null) { waitMs += Math.max(0, at - waitingSince); waitingSince = null; }
        ended = { start, at, kind: k };
      }
    } else continue;
    settle(at);
  }
  return { open: starts.size > 0, start: starts.size ? first() : null, period, waitMs, waitingSince };
}
export function progressPeriod(events: Event[], rules: Rules = {}): ProgressPeriod {
  const state = replayWork(events, rules);
  return state.open
    ? { start: state.start, waitMs: state.waitMs, waitingSince: state.waitingSince === null ? null : new Date(state.waitingSince).toISOString() }
    : { start: null, waitMs: 0, waitingSince: null };
}
export function progressStart(
  events: Event[],
  rules: Rules = {},
): string | null {
  return progressPeriod(events, rules).start;
}
/**
 * Last work period before the issue closed at `closedAt` (#141, #392), from its label events in any
 * order: its start and the time it only waited for integration. The period may have ended before
 * closing (e.g. the label was removed on delivery). Events after `closedAt` and periods before a
 * reopening are ignored. Null when the events show no work period for this closing.
 */
export function closedWorkPeriod(events: Event[], closedAt: string, rules: Rules = {}): { start: string; waitMs: number } | null {
  const closed = Date.parse(closedAt);
  if (!Number.isFinite(closed)) return null;
  const state = replayWork(events, rules, closed, false);
  if (!state.period) return null;
  const waiting = state.waitingSince !== null ? Math.max(0, closed - state.waitingSince) : 0;
  return { start: state.period, waitMs: state.waitMs + waiting };
}
export function closedWorkStart(events: Event[], closedAt: string, rules: Rules = {}): string | null {
  return closedWorkPeriod(events, closedAt, rules)?.start ?? null;
}
/** A repository issue event as the statistics collection keeps it (#135/#141). */
export interface RepositoryIssueEvent extends Event { issue?: { id: number } }
/**
 * Fills `workStartedAt` for the lane's closed issues that lack it from already fetched repository
 * issue events (#141), without any request. Returns the same lane when nothing changes, so the
 * caller can keep the shown object (lanes are replaced, never mutated).
 */
export function deriveWorkStarts(lane: Lane, events: readonly RepositoryIssueEvent[], rules: Rules = {}): Lane {
  const missing = new Map(lane.issues.filter((issue) => issue.state === "closed" && issue.closed_at && !issue.workStartedAt && !issue.pull_request).map((issue) => [issue.id, issue]));
  if (!missing.size) return lane;
  const byIssue = new Map<number, Event[]>();
  for (const event of events) {
    const id = event?.issue?.id;
    if (id === undefined || !missing.has(id) || typeof event.created_at !== "string" || typeof event.event !== "string" ||
      (event.label !== undefined && typeof event.label?.name !== "string")) continue;
    (byIssue.get(id) ?? byIssue.set(id, []).get(id)!).push(event);
  }
  const starts = new Map<number, { start: string; waitMs: number }>();
  for (const [id, list] of byIssue) {
    const period = closedWorkPeriod(list, missing.get(id)!.closed_at!, rules);
    if (period) starts.set(id, period);
  }
  if (!starts.size) return lane;
  return { ...lane, issues: lane.issues.map((issue) => {
    const period = starts.get(issue.id);
    return period ? { ...issue, workStartedAt: period.start, ...(period.waitMs > 0 ? { waitMs: period.waitMs } : {}) } : issue;
  }) };
}
/**
 * Closing work start for a freshly synced closed issue (#141): the previous board copy's own
 * `workStartedAt` for the same closing, or its in-progress `startedAt` when it was in progress.
 */
export function carriedWorkStart(issue: Issue, old: Issue | undefined, rules: Rules = {}): string | undefined {
  if (issue.state !== "closed" || !issue.closed_at || !old) return undefined;
  const valid = (value: string | null | undefined) => {
    const ms = value ? Date.parse(value) : NaN;
    return Number.isFinite(ms) && ms <= Date.parse(issue.closed_at!) ? value! : undefined;
  };
  if (old.state === "closed") return old.closed_at === issue.closed_at ? valid(old.workStartedAt) : undefined;
  return column(old, rules) === "progress" && !old.timerError ? valid(old.startedAt) : undefined;
}
/**
 * Closing enrichment for a freshly synced closed issue (#141, #392): the carried work start and the
 * integration waits already recorded for that period. A wait still running when last seen is not
 * extended to the closing, since integration normally resumes active work before closure.
 */
export function carriedWork(issue: Issue, old: Issue | undefined, rules: Rules = {}): Pick<Issue, "workStartedAt" | "waitMs"> | undefined {
  const workStartedAt = carriedWorkStart(issue, old, rules);
  if (!workStartedAt) return undefined;
  const waitMs = validWait(old!.waitMs);
  return { workStartedAt, ...(waitMs ? { waitMs } : {}) };
}
const validWait = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
const ms = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);
/**
 * Virtual start of an open issue's active working time (#392): now − start is the active time of
 * its In progress period, without integration waits. Null when it is not running (closed, waiting
 * for integration or unknown); callers decide whether the issue is in progress. Without recorded
 * waits this is `startedAt`.
 */
export function activeWorkStart(issue: Issue, rules: Rules = {}): string | null {
  if (issue.timerError || issue.state === "closed" || awaitsIntegration(issue, rules)) return null;
  const start = ms(issue.startedAt);
  if (!Number.isFinite(start)) return null;
  // Labels are authoritative: a just-resumed issue whose events still show a wait counts from now on.
  return new Date(start + validWait(issue.waitMs)).toISOString();
}
/**
 * Active working time of an open In progress issue at `now` (#392): running time without integration
 * waits, frozen while it waits. Negative for a future start; NaN when unknown.
 */
export function activeWorkMs(issue: Issue, now: number, rules: Rules = {}): number {
  if (issue.timerError || issue.state === "closed") return NaN;
  const running = activeWorkStart(issue, rules);
  if (running) return now - Date.parse(running);
  if (!awaitsIntegration(issue, rules)) return NaN;
  const start = ms(issue.startedAt), since = ms(issue.waitingSince);
  // Waiting: the active time up to when the current wait began.
  return Number.isFinite(start) && Number.isFinite(since) ? Math.max(0, since - start - validWait(issue.waitMs)) : NaN;
}
/** Measured active work of a closed issue's last work period (#141, #392): start → close minus waits. */
export function closedWorkMs(issue: Issue): number {
  const start = ms(issue.workStartedAt ?? issue.startedAt), end = ms(issue.closed_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return NaN;
  const active = end - start - validWait(issue.waitMs);
  return active > 0 ? active : NaN;
}
export function duration(start: string, now: number) {
  return durationLabel(now - Date.parse(start));
}
/** The same compact label as `duration` for a measured length, such as active working time (#392). */
export function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days
    ? `${days}d ${hours}h ${minutes}m`
    : hours
      ? `${hours}h ${minutes}m`
      : `${minutes}m ${seconds % 60}s`;
}
export function workflow(labels: Label[]) {
  return labels.some((l) => normalize(l.name).startsWith("priority "))
    ? t("Prioritetslabels")
    : labels.some((l) => normalize(l.name) === "reviewer filed")
      ? t("Agentflöde")
      : labels.some((l) => /^p[0-4]$/.test(normalize(l.name)))
        ? "P0–P4"
        : t("Standardflöde");
}
