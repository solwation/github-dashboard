import { matchesIssueFilters } from "./issue-filter";
import { column, isCoordination, type Issue, type Lane, type Rules } from "./model";
import { approximatePoints } from "./story-points";
import { repositoryEstimate, type SubIssueWork } from "./estimates";

export interface OverviewEstimateGroup { repository: string; issues: Issue[]; rules: Rules }
export type OverviewEstimateColumn = "open" | "progress";

/** The badge and its points use the same query scope, counting each repository issue once. */
export function overviewEstimateGroups(lanes: Lane[], rules: Record<string, Rules>, hideCoordination: boolean,
  filters: { query?: string; repositoryQueries?: Record<string, string> } = {}): OverviewEstimateGroup[] {
  const groups = new Map<string, OverviewEstimateGroup>();
  const seen = new Set<string>();
  for (const lane of lanes) {
    const repository = lane.repo.full_name;
    let group = groups.get(repository);
    if (!group) { group = { repository, issues: [], rules: rules[repository] || {} }; groups.set(repository, group); }
    for (const issue of lane.issues) {
      const key = `${repository}:${issue.id}`;
      if (seen.has(key) || issue.pull_request || (hideCoordination && isCoordination(issue)) ||
        !matchesIssueFilters(issue, filters.query || "", filters.repositoryQueries?.[repository] || "")) continue;
      seen.add(key); group.issues.push(issue);
    }
  }
  return [...groups.values()];
}
const selected = (group: OverviewEstimateGroup, key: OverviewEstimateColumn) => group.issues.filter(issue =>
  key === "open" ? issue.state === "open" : column(issue, group.rules) === "progress");
export function overviewPoints(groups: OverviewEstimateGroup[], key: OverviewEstimateColumn): number {
  return groups.reduce((total, group) => total + selected(group, key).reduce((sum, issue) => sum + approximatePoints(issue), 0), 0);
}

/** Repositories run in parallel; open work includes the backlog horizon after current work. */
export function overviewTimeEstimate(groups: OverviewEstimateGroup[], key: OverviewEstimateColumn, now: number,
  children?: ReadonlyMap<number, readonly SubIssueWork[]>) {
  let repositories = 0, knownRepositories = 0, remainingMs = 0, overdue = 0, unknownStart = 0, counting = false;
  let nextStartMs = Infinity;
  for (const group of groups) {
    if (!selected(group, key).length) continue;
    repositories++;
    const estimate = repositoryEstimate(group.issues, now, { rules: group.rules, children });
    if (estimate.basis.msPerPoint === null) continue;
    knownRepositories++;
    remainingMs = Math.max(remainingMs, estimate.progress?.remainingMs ?? 0, key === "open" ? estimate.backlog?.remainingMs ?? 0 : 0);
    overdue += estimate.progress?.overdue ?? 0;
    for (const item of estimate.progress?.items ?? []) {
      const start = Date.parse(item.issue.startedAt || "");
      if (start > now) nextStartMs = Math.min(nextStartMs, start);
    }
    unknownStart += estimate.progress?.items.filter(item => item.unknownStart || Date.parse(item.issue.startedAt || "") > now).length ?? 0;
    counting ||= !!estimate.progress?.items.some(item => item.counting);
  }
  return { repositories, knownRepositories, remainingMs: knownRepositories ? remainingMs : null, overdue, unknownStart, counting, nextStartMs };
}
