import { column, isCoordination, type Lane, type Rules } from "./model";

export interface SidebarRepository {
  id: number;
  name: string;
  backlog: number;
  progress: number;
  closed: number;
  changedAt: string | null;
}

/** Summarize the loaded lanes before text search. Closed issues already use the API's 30-day window. */
export function summarizeLanes(
  lanes: Lane[],
  rules: Record<string, Rules>,
  hideCoordination: boolean,
): SidebarRepository[] {
  return lanes.map((lane) => {
    const summary: SidebarRepository = {
      id: lane.repo.id,
      name: lane.repo.name,
      backlog: 0,
      progress: 0,
      closed: 0,
      changedAt: null,
    };
    let latest = -Infinity;
    for (const issue of lane.issues) {
      if (issue.pull_request || (hideCoordination && isCoordination(issue))) continue;
      summary[column(issue, rules[lane.repo.full_name])]++;
      const changed = Date.parse(issue.updated_at);
      if (Number.isFinite(changed) && changed > latest) {
        latest = changed;
        summary.changedAt = issue.updated_at;
      }
    }
    return summary;
  });
}

export function recentlyChanged(changedAt: string | null, now: number): boolean {
  if (!changedAt) return false;
  const elapsed = now - Date.parse(changedAt);
  return elapsed >= 0 && elapsed <= 5 * 60 * 1000;
}
