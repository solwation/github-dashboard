import { countActiveRepositories, summarizeLanes, type SidebarRepository } from "./sidebar";
import { matchesIssueFilters } from "./issue-filter";
import { column, isCoordination, priority, type Lane, type Rules } from "./model";

export interface OverviewCounts { open: number; progress: number; closed: number }
export interface OverviewSecondaryCounts {
  activeRepositories: number;
  backlogRepositories: number;
  backlogIssues: number;
  highPriorityOpen: number;
  progressRepositories: number;
  highPriorityProgress: number;
  closedToday: number;
  closedLast7Days: number;
}
export const emptyCounts = (): OverviewCounts => ({ open: 0, progress: 0, closed: 0 });
export const overviewKeys = ["open", "progress", "closed"] as const;
export const OVERVIEW_DELTA_MS = 3000;
export type OverviewOutcome = "positive" | "negative" | null;
type IssueColumn = ReturnType<typeof column>;

function snapshot(lane: Lane, rules: Rules, hideCoordination: boolean, query = "", repositoryQuery = "") {
  const counts = emptyCounts();
  const columns = new Map<number, IssueColumn>();
  for (const issue of lane.issues) {
    if (columns.has(issue.id) || issue.pull_request || (hideCoordination && isCoordination(issue)) || !matchesIssueFilters(issue, query, repositoryQuery)) continue;
    const col = column(issue, rules);
    columns.set(issue.id, col);
    if (issue.state === "open") counts.open++;
    if (col === "progress") counts.progress++;
    if (issue.state === "closed") counts.closed++;
  }
  return { counts, columns };
}

/** Filter changes reset the baseline; only subsequent GitHub changes animate visible counts. */
export class OverviewFeedbackTracker {
  private signature = "";
  private snapshots = new Map<string, ReturnType<typeof snapshot>>();
  progressOutcome: OverviewOutcome = null;

  update(lanes: Lane[], rules: Record<string, Rules>, hideCoordination: boolean, live: boolean, session: string | number, filters: { query?: string; repositoryQueries?: Record<string, string> } = {}): OverviewCounts {
    this.progressOutcome = null;
    if (!live) { this.clear(); return emptyCounts(); }
    const repos = [...new Set(lanes.map(lane => lane.repo.full_name))].sort();
    const signature = JSON.stringify([session, hideCoordination, filters.query || "", repos.map(repo => [repo, filters.repositoryQueries?.[repo] || "", Object.entries(rules[repo] || {}).sort(([a], [b]) => a.localeCompare(b))])]);
    const reset = signature !== this.signature;
    if (reset) this.snapshots.clear();
    this.signature = signature;
    const delta = emptyCounts();
    for (const lane of lanes) {
      if (lane.error) continue;
      const repo = lane.repo.full_name;
      const next = snapshot(lane, rules[repo] || {}, hideCoordination, filters.query, filters.repositoryQueries?.[repo]);
      const before = this.snapshots.get(repo);
      if (!reset && before) {
        for (const key of overviewKeys) delta[key] += next.counts[key] - before.counts[key];
        for (const [id, col] of next.columns) {
          if (before.columns.get(id) !== "progress") continue;
          if (col === "backlog") this.progressOutcome = "negative";
          else if (col === "closed" && this.progressOutcome !== "negative") this.progressOutcome = "positive";
        }
      }
      this.snapshots.set(repo, next);
    }
    return delta;
  }
  clear() { this.signature = ""; this.snapshots.clear(); this.progressOutcome = null; }
}

/** Current closed issues whose latest closure is on the viewer's local calendar day. */
export function countClosedToday(lanes: Lane[], now: number, hideCoordination = false): number {
  const today = new Date(now);
  if (!Number.isFinite(today.getTime())) return 0;
  const seen = new Set<string>();
  let count = 0;
  for (const lane of lanes) for (const issue of lane.issues) {
    if (issue.pull_request || (hideCoordination && isCoordination(issue)) || issue.state !== "closed" || !issue.closed_at) continue;
    const key = `${lane.repo.full_name}:${issue.id}`;
    if (seen.has(key)) continue;
    const date = new Date(issue.closed_at);
    if (date.getTime() <= now && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
      seen.add(key); count++;
    }
  }
  return count;
}

/** Secondary two-cell breakdown for the four overview summary cards (#152). */
export function summarizeOverviewSecondary(
  lanes: Lane[],
  rules: Record<string, Rules>,
  now: number,
  hideCoordination = false,
  filters: { query?: string; repositoryQueries?: Record<string, string> } = {},
  repositories: readonly SidebarRepository[] = summarizeLanes(lanes, rules, hideCoordination),
): OverviewSecondaryCounts {
  const backlogRepos = new Set<string>();
  const progressRepos = new Set<string>();
  const seenFiltered = new Set<string>();
  const seenClosed = new Set<string>();
  const cutoff7d = Number.isFinite(now) ? now - 7 * 86400000 : NaN;
  let backlogIssues = 0;
  let highPriorityOpen = 0;
  let highPriorityProgress = 0;
  let closedLast7Days = 0;
  for (const lane of lanes) {
    const repo = lane.repo.full_name;
    const repoRules = rules[repo] || {};
    const repoQuery = filters.repositoryQueries?.[repo] || "";
    for (const issue of lane.issues) {
      if (issue.pull_request || (hideCoordination && isCoordination(issue))) continue;
      const col = column(issue, repoRules);
      if (col === "backlog") backlogRepos.add(repo);
      const key = `${repo}:${issue.id}`;
      if (issue.state === "closed" && issue.closed_at && !seenClosed.has(key) && Number.isFinite(cutoff7d)) {
        const closed = Date.parse(issue.closed_at);
        if (closed >= cutoff7d && closed <= now) {
          seenClosed.add(key);
          closedLast7Days++;
        }
      }
      if (seenFiltered.has(key) || !matchesIssueFilters(issue, filters.query || "", repoQuery)) continue;
      seenFiltered.add(key);
      const high = priority(issue, repoRules) === 0;
      if (issue.state === "open") {
        if (col === "backlog") backlogIssues++;
        if (high) highPriorityOpen++;
      }
      if (col === "progress") {
        progressRepos.add(repo);
        if (high) highPriorityProgress++;
      }
    }
  }
  return {
    activeRepositories: countActiveRepositories(repositories),
    backlogRepositories: backlogRepos.size,
    backlogIssues,
    highPriorityOpen,
    progressRepositories: progressRepos.size,
    highPriorityProgress,
    closedToday: countClosedToday(lanes, now, hideCoordination),
    closedLast7Days,
  };
}

export const signedDelta = (delta: number) => delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
