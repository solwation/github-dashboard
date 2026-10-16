import { column, isCoordination, priority, type Issue, type Lane, type Rules } from "./model";
import { matchesIssueFilters } from "./issue-filter";
export interface BoardEntry { lane: Lane; issue: Issue }
/** Keep origin and per-repository rules alongside every issue; IDs need not be global. */
export function combinedItems(lanes: Lane[], key: string, rules: Record<string, Rules>, filters: { query: string; repositoryQueries: Record<string, string>; hideCoordination: boolean }): BoardEntry[] {
  const entries = lanes.flatMap(lane => lane.loading ? [] : lane.issues.filter(issue =>
    !issue.pull_request && column(issue, rules[lane.repo.full_name]) === key &&
    (!filters.hideCoordination || !isCoordination(issue)) &&
    matchesIssueFilters(issue, filters.query, filters.repositoryQueries[lane.repo.full_name] || ""),
  ).map(issue => ({ lane, issue })));
  return entries.sort((a, b) => {
    if (key === "closed") return Date.parse(b.issue.closed_at!) - Date.parse(a.issue.closed_at!);
    if (key === "backlog") return priority(a.issue, rules[a.lane.repo.full_name]) - priority(b.issue, rules[b.lane.repo.full_name]) || Date.parse(a.issue.created_at) - Date.parse(b.issue.created_at);
    return Date.parse(a.issue.startedAt || a.issue.created_at) - Date.parse(b.issue.startedAt || b.issue.created_at);
  });
}
export function boardEntryKey(entry: BoardEntry, key: string): string {
  return JSON.stringify([entry.lane.repo.full_name, entry.issue.id, key === "closed" ? entry.issue.closed_at : null]);
}
