import { column, type Issue, type Lane, type Rules } from './model';
export const DEFAULT_TIMEOUT_MINUTES = 30;
export const MAX_TIMEOUT_MINUTES = 10080;
export function parseTimeoutMinutes(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_TIMEOUT_MINUTES ? minutes : null;
}
interface WorkPeriod { repo: string; issueId: number; startedAt: string }
export interface TimeoutEntry { key: string; repo: string; issue: Issue; elapsedMs: number }
function workPeriod(repo: string, issue: Pick<Issue, 'id' | 'startedAt'>): WorkPeriod | null {
  const started = typeof issue.startedAt === 'string' ? Date.parse(issue.startedAt) : NaN;
  return typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && Number.isSafeInteger(issue.id) && issue.id > 0 && Number.isFinite(started)
    ? { repo, issueId: issue.id, startedAt: new Date(started).toISOString() } : null;
}
function key(value: WorkPeriod) { return JSON.stringify([value.repo, value.issueId, value.startedAt]); }
/**
 * Timed-out cards stay marked for the whole work period. Notifications are sent once per
 * period; after reload the caller's first scan with notify: false records cached timeouts
 * as already notified, so a reload never repeats them.
 */
export class TimeoutTracker {
  private notified = new Set<string>();
  clear() { this.notified.clear(); }
  scan(lanes: Lane[], rules: Record<string, Rules>, minutes: number, now: number, options: { notify?: boolean } = {}) {
    const active: TimeoutEntry[] = [];
    const newlyTimedOut: TimeoutEntry[] = [];
    const currentPeriods = new Set<string>();
    const loaded = new Map(lanes.map(lane => [lane.repo.full_name, lane]));
    const threshold = parseTimeoutMinutes(minutes) ?? DEFAULT_TIMEOUT_MINUTES;
    for (const lane of lanes) for (const issue of lane.issues) {
      if (column(issue, rules[lane.repo.full_name]) !== 'progress' || issue.timerError) continue;
      const item = workPeriod(lane.repo.full_name, issue);
      if (!item) continue;
      const period = key(item);
      currentPeriods.add(period);
      const elapsedMs = now - Date.parse(item.startedAt);
      if (!Number.isFinite(elapsedMs) || elapsedMs <= threshold * 60000) continue;
      const entry = { key: period, repo: lane.repo.full_name, issue, elapsedMs };
      active.push(entry);
      if (!this.notified.has(period)) {
        this.notified.add(period);
        if (options.notify !== false) newlyTimedOut.push(entry);
      }
    }
    // An unavailable lane or uncertain timeline cannot prove a work period ended.
    const ended = (period: string, item: WorkPeriod) => {
      const lane = loaded.get(item.repo);
      if (!lane || lane.error) return false;
      const issue = lane.issues.find(issue => issue.id === item.issueId);
      if (!issue) return false;
      if (column(issue, rules[item.repo]) !== 'progress') return true;
      if (issue.timerError || !issue.startedAt) return false;
      return !currentPeriods.has(period);
    };
    for (const period of this.notified) {
      try {
        const [repo, issueId, startedAt] = JSON.parse(period);
        if (ended(period, { repo, issueId, startedAt })) this.notified.delete(period);
      } catch { this.notified.delete(period); }
    }
    return { active, newlyTimedOut };
  }
}
