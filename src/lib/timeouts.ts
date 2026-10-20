import { t } from "./i18n";
import { column, duration, type Issue, type Lane, type Rules } from './model';
import { issueEstimate, repositoryEstimate, nextHistoryExpiry, estimateLabel } from './estimates';
export const DEFAULT_TIMEOUT_OVERRUN_PERCENT = 25;
export const MAX_TIMEOUT_OVERRUN_PERCENT = 1000;
export interface TimeoutSettings { timeoutEnabled: boolean; timeoutOverrunPercent: number }
export function parseTimeoutOverrunPercent(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const percent = Number(value);
  return Number.isSafeInteger(percent) && percent >= 0 && percent <= MAX_TIMEOUT_OVERRUN_PERCENT ? percent : null;
}
/** Legacy minute values deliberately never become percentages. */
export function normalizeTimeoutSettings(value: unknown): TimeoutSettings {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { timeoutEnabled: typeof settings.timeoutEnabled === 'boolean' ? settings.timeoutEnabled : true,
    timeoutOverrunPercent: parseTimeoutOverrunPercent(settings.timeoutOverrunPercent) ?? DEFAULT_TIMEOUT_OVERRUN_PERCENT };
}
export type TimeoutBases = Map<string, number | null>;
export function timeoutBases(lanes: Lane[], rules: Record<string, Rules>, now: number): TimeoutBases {
  return new Map(lanes.map(lane => [lane.repo.full_name, repositoryEstimate(lane.issues, now, { rules: rules[lane.repo.full_name] }).basis.msPerPoint]));
}
function thresholdFor(issue: Issue, rate: number | null | undefined, settings: TimeoutSettings, now: number) {
  const estimate = issueEstimate(issue, rate, now, true);
  return estimate && estimate.remainingMs !== null ? estimate.totalMs * (1 + settings.timeoutOverrunPercent / 100) : null;
}
interface WorkPeriod { repo: string; issueId: number; startedAt: string }
export interface TimeoutEntry { key: string; repo: string; issue: Issue; elapsedMs: number; estimatedMs: number; thresholdMs: number }
export function timeoutDetail(issue: Issue, estimatedMs: number, percent: number, now: number) {
  return t('Pågående i {duration}, över estimatet {estimate} plus {percent} %.', {
    duration: issue.startedAt ? duration(issue.startedAt, now) : '', estimate: estimateLabel(estimatedMs), percent,
  });
}
function workPeriod(repo: string, issue: Pick<Issue, 'id' | 'startedAt'>): WorkPeriod | null {
  const started = typeof issue.startedAt === 'string' ? Date.parse(issue.startedAt) : NaN;
  return typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && Number.isSafeInteger(issue.id) && issue.id > 0 && Number.isFinite(started)
    ? { repo, issueId: issue.id, startedAt: new Date(started).toISOString() } : null;
}
function key(value: WorkPeriod) { return JSON.stringify([value.repo, value.issueId, value.startedAt]); }
/** The next moment an in-progress work period crosses the threshold, so callers scan then instead of every second. */
export function nextTimeout(lanes: Lane[], rules: Record<string, Rules>, settings: TimeoutSettings, now: number, bases = timeoutBases(lanes, rules, now)): number | null {
  if (!settings.timeoutEnabled) return null;
  let next = Infinity;
  for (const lane of lanes) {
    const expiry = nextHistoryExpiry(lane.issues, now, { rules: rules[lane.repo.full_name] });
    if (expiry !== null) next = Math.min(next, expiry);
    for (const issue of lane.issues) {
      if (issue.pull_request || column(issue, rules[lane.repo.full_name]) !== 'progress' || issue.timerError) continue;
      const item = workPeriod(lane.repo.full_name, issue);
      const started = item ? Date.parse(item.startedAt) : NaN;
      const rate = bases.get(lane.repo.full_name);
      if (started > now && rate != null && Number.isFinite(rate) && rate > 0) next = Math.min(next, started);
      const threshold = thresholdFor(issue, rate, settings, now);
      const crossing = item && threshold !== null ? Math.floor(Date.parse(item.startedAt) + threshold) + 1 : NaN;
      if (crossing > now) next = Math.min(next, crossing);
    }
  }
  return Number.isFinite(next) ? next : null;
}
/**
 * Flags follow the current estimate and tolerance. Notify once per verified work period;
 * the first scan and changes to settings/calibration establish a silent baseline. Cached
 * restores can additionally suppress notifications without hiding current warnings.
 */
export class TimeoutTracker {
  private notified = new Set<string>();
  private settingsKey: string | null = null;
  private calibrationKey: string | null = null;
  clear() { this.notified.clear(); this.settingsKey = null; this.calibrationKey = null; }
  scan(lanes: Lane[], rules: Record<string, Rules>, settings: TimeoutSettings, now: number, options: { notify?: boolean; bases?: TimeoutBases } = {}) {
    const active: TimeoutEntry[] = [];
    const newlyTimedOut: TimeoutEntry[] = [];
    const currentPeriods = new Set<string>();
    const loaded = new Map(lanes.map(lane => [lane.repo.full_name, lane]));
    const signature = JSON.stringify(settings);
    const bases = options.bases ?? (settings.timeoutEnabled ? timeoutBases(lanes, rules, now) : new Map());
    const calibration = JSON.stringify([...bases].sort(([left], [right]) => left.localeCompare(right)));
    const notify = options.notify !== false && this.settingsKey === signature && this.calibrationKey === calibration;
    this.settingsKey = signature;
    this.calibrationKey = calibration;
    for (const lane of lanes) for (const issue of lane.issues) {
      if (issue.pull_request || column(issue, rules[lane.repo.full_name]) !== 'progress' || issue.timerError) continue;
      const item = workPeriod(lane.repo.full_name, issue);
      if (!item) continue;
      const period = key(item);
      currentPeriods.add(period);
      const elapsedMs = now - Date.parse(item.startedAt);
      if (!settings.timeoutEnabled) continue;
      const thresholdMs = thresholdFor(issue, bases.get(lane.repo.full_name), settings, now);
      if (thresholdMs === null || !Number.isFinite(elapsedMs) || elapsedMs <= thresholdMs) continue;
      const estimatedMs = thresholdMs / (1 + settings.timeoutOverrunPercent / 100);
      const entry = { key: period, repo: lane.repo.full_name, issue, elapsedMs, estimatedMs, thresholdMs };
      active.push(entry);
      if (!this.notified.has(period)) {
        this.notified.add(period);
        if (notify) newlyTimedOut.push(entry);
      }
    }
    // An unavailable lane or uncertain timeline cannot prove a work period ended.
    const ended = (period: string, item: WorkPeriod) => {
      const lane = loaded.get(item.repo);
      if (!lane || lane.error) return false;
      const issue = lane.issues.find(issue => issue.id === item.issueId);
      if (!issue) return false;
      if (column(issue, rules[item.repo]) !== 'progress') return true;
      if (issue.timerError || !issue.startedAt || !Number.isFinite(Date.parse(issue.startedAt)) || Date.parse(issue.startedAt) > now) return false;
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
