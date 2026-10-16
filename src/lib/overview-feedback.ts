import { column, isCoordination, type Lane, type Rules } from "./model";

export interface OverviewCounts { open: number; progress: number; closed: number }
export const emptyCounts = (): OverviewCounts => ({ open: 0, progress: 0, closed: 0 });
export const overviewKeys = ["open", "progress", "closed"] as const;
export const OVERVIEW_DELTA_MS = 3000;

function count(lane: Lane, rules: Rules, hideCoordination: boolean): OverviewCounts {
  const counts = emptyCounts();
  const seen = new Set<number>();
  for (const issue of lane.issues) {
    if (seen.has(issue.id) || issue.pull_request || (hideCoordination && isCoordination(issue))) continue;
    seen.add(issue.id);
    if (issue.state === "open") counts.open++;
    if (column(issue, rules) === "progress") counts.progress++;
    if (issue.state === "closed") counts.closed++;
  }
  return counts;
}

/** Baselines track successful GitHub snapshots, never the current text search. */
export class OverviewFeedbackTracker {
  private signature = "";
  private snapshots = new Map<string, OverviewCounts>();

  update(lanes: Lane[], rules: Record<string, Rules>, hideCoordination: boolean, live: boolean, session: string | number): OverviewCounts {
    if (!live) { this.clear(); return emptyCounts(); }
    const repos = [...new Set(lanes.map(lane => lane.repo.full_name))].sort();
    const signature = JSON.stringify([session, hideCoordination, repos.map(repo => [repo, Object.entries(rules[repo] || {}).sort(([a], [b]) => a.localeCompare(b))])]);
    const reset = signature !== this.signature;
    if (reset) this.snapshots.clear();
    this.signature = signature;
    const delta = emptyCounts();
    for (const lane of lanes) {
      if (lane.error) continue;
      const repo = lane.repo.full_name;
      const counts = count(lane, rules[repo] || {}, hideCoordination);
      const before = this.snapshots.get(repo);
      if (!reset && before) for (const key of overviewKeys) delta[key] += counts[key] - before[key];
      this.snapshots.set(repo, counts);
    }
    return delta;
  }
  clear() { this.signature = ""; this.snapshots.clear(); }
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

export const signedDelta = (delta: number) => delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
