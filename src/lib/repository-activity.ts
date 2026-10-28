import { column, isCoordination, type Issue, type Lane, type Rules } from "./model";
import { WORK_INACTIVITY_MS } from "./work-activity";

export const REPOSITORY_ACTIVITY_MS = WORK_INACTIVITY_MS;
export interface RepositoryActivity {
  repository: string;
  latestAt: number;
  issues: number;
  claimed: boolean;
  coordination?: Issue;
}
/** Recent GitHub metadata is evidence of observed work, never a live process count. */
export function repositoryActivity(lane: Lane, rules: Rules, now: number): RepositoryActivity | null {
  if (lane.loading || lane.error || !Number.isFinite(now)) return null;
  const active = lane.issues.filter(issue => {
    const updated = Date.parse(issue.updated_at);
    return !issue.pull_request && !isCoordination(issue) && column(issue, rules) === "progress"
      && Number.isFinite(updated) && updated <= now && now - updated < REPOSITORY_ACTIVITY_MS;
  });
  if (!active.length) return null;
  const coordination = lane.issues.filter(issue => !issue.pull_request && issue.state === "open" && isCoordination(issue))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.number - b.number)[0];
  return {
    repository: lane.repo.full_name,
    latestAt: Math.max(...active.map(issue => Date.parse(issue.updated_at))),
    issues: new Set(active.map(issue => issue.id)).size,
    claimed: active.some(issue => issue.labels.some(label => /^orkester:\s*\S/i.test(label.name.trim()))),
    coordination,
  };
}
