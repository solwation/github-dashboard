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
}
export interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
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
// Progress labels are redundant in the In progress column and misleading on closed issues (#264).
export const hidesProgressLabel = (col: string) => col === "progress" || col === "closed";
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
    : issue.labels.some((l) => isProgress(l.name, rules))
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
export function progressStart(
  events: Event[],
  rules: Rules = {},
): string | null {
  const active = new Map<string, string>();
  for (const e of [...events].sort(
    (a, b) =>
      Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
  )) {
    if (e.event === "closed" || e.event === "reopened") active.clear();
    if (!e.label || !isProgress(e.label.name, rules)) continue;
    if (e.event === "labeled") active.set(e.label.name, e.created_at);
    if (e.event === "unlabeled") active.delete(e.label.name);
  }
  return [...active.values()].sort()[0] || null;
}
/**
 * Start of the last in-progress period before the issue closed at `closedAt` (#141), from its
 * label events in any order. The period may have ended before closing (e.g. the label was removed
 * on delivery). Events after `closedAt` and periods before a reopening are ignored. Null when the
 * events show no in-progress period for this closing.
 */
export function closedWorkStart(events: Event[], closedAt: string, rules: Rules = {}): string | null {
  const closed = Date.parse(closedAt);
  if (!Number.isFinite(closed)) return null;
  const active = new Set<string>();
  let start: string | null = null;
  for (const e of [...events].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id,
  )) {
    const at = Date.parse(e.created_at);
    if (!Number.isFinite(at) || at > closed) break;
    if (e.event === "reopened") { active.clear(); start = null; continue; }
    if (!e.label || !isProgress(e.label.name, rules)) continue;
    if (e.event === "labeled") { if (!active.size) start = e.created_at; active.add(e.label.name); }
    if (e.event === "unlabeled") active.delete(e.label.name);
  }
  return start;
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
  const starts = new Map<number, string>();
  for (const [id, list] of byIssue) {
    const start = closedWorkStart(list, missing.get(id)!.closed_at!, rules);
    if (start) starts.set(id, start);
  }
  if (!starts.size) return lane;
  return { ...lane, issues: lane.issues.map((issue) => starts.has(issue.id) ? { ...issue, workStartedAt: starts.get(issue.id)! } : issue) };
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
export function duration(start: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(start)) / 1000));
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
