import { column, compareColumnIssues, isCoordination, type ColumnSort, type Issue, type Lane, type Rules } from "./model";
import { matchesIssueFilters } from "./issue-filter";
export interface BoardEntry { lane: Lane; issue: Issue }
/** Keep origin and per-repository rules alongside every issue; IDs need not be global. */
export function combinedItems(lanes: Lane[], key: string, rules: Record<string, Rules>, filters: { query: string; hideCoordination: boolean }, sort: ColumnSort = "default"): BoardEntry[] {
  const entries = lanes.flatMap(lane => lane.loading ? [] : lane.issues.filter(issue =>
    !issue.pull_request && column(issue, rules[lane.repo.full_name]) === key &&
    (!filters.hideCoordination || !isCoordination(issue)) &&
    matchesIssueFilters(issue, filters.query, ""),
  ).map(issue => ({ lane, issue })));
  return entries.sort((a, b) => compareColumnIssues(key, sort, a.issue, b.issue, rules[a.lane.repo.full_name], rules[b.lane.repo.full_name]));
}
export function boardEntryKey(entry: BoardEntry, key: string): string {
  return JSON.stringify([entry.lane.repo.full_name, entry.issue.id, key === "closed" ? entry.issue.closed_at : null]);
}
