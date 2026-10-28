import { column, isCoordination, type Issue, type Rules } from "./model";

/** Orchestra recommends investigating after 45–60 minutes without concrete progress. */
export const WORK_INACTIVITY_MS = 60 * 60 * 1000;

/**
 * A lack of visible issue activity is a reason to investigate, never an online/offline test.
 * updated_at includes comments and metadata changes, so even a fresh value is not proof of
 * agent progress. A coordination thread's activity cannot establish this issue's liveness.
 */
export function inactiveWork(issue: Issue, rules: Rules, now: number): { lastActivityMs: number; idleMs: number } | null {
  if (issue.pull_request || isCoordination(issue) || column(issue, rules) !== "progress") return null;
  const start = Date.parse(issue.startedAt ?? ""), updated = Date.parse(issue.updated_at);
  if (!Number.isFinite(start) || !Number.isFinite(updated) || !Number.isFinite(now)) return null;
  const lastActivityMs = Math.max(start, updated), idleMs = now - lastActivityMs;
  return idleMs >= WORK_INACTIVITY_MS ? { lastActivityMs, idleMs } : null;
}
