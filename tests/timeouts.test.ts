import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_OVERRUN_PERCENT, nextTimeout, parseTimeoutOverrunPercent, normalizeTimeoutSettings, TimeoutTracker } from '../src/lib/timeouts';
import type { Issue, Lane } from '../src/lib/model';
const start = '2026-10-16T10:00:00Z';
const now = Date.parse(start) + 31 * 60000;
function issue(id = 1, startedAt: string | null = start, label = 'in-progress'): Issue {
  return { id, number: id, title: 'Fixture', state: 'open', html_url: `https://github.com/sample/repo/issues/${id}`, created_at: '2020-01-01T00:00:00Z', updated_at: start, closed_at: null, labels: [{ name: label, color: '000000' }], assignees: [], startedAt };
}
const settings = { timeoutEnabled: true, timeoutOverrunPercent: 0 };
function history() { return [101, 102, 103].map(id => ({ ...issue(id), state: 'closed' as const, labels: [], startedAt: new Date(Date.parse(start) - 90 * 60000).toISOString(), workStartedAt: new Date(Date.parse(start) - 90 * 60000).toISOString(), closed_at: new Date(Date.parse(start) - 60 * 60000).toISOString() })); }
function makeTracker() { const value = new TimeoutTracker(); value.scan([lane()], {}, settings, Date.parse(start)); return value; }
function lane(issues = [issue()]): Lane { return { repo: { id: 1, full_name: 'sample/repo' } as Lane['repo'], issues: [...issues, ...history()], labels: [] }; }
describe('timeouts follow actual continuous work periods', () => {
  it('schedules the next scan at the first strict threshold crossing instead of ticking', () => {
    const later = new Date(Date.parse(start) + 10 * 60000).toISOString();
    const work = lane([issue(1, start), issue(2, later), issue(3, null), { ...issue(4), timerError: true }, { ...issue(5), state: 'closed' }]);
    expect(nextTimeout([work], {}, settings, Date.parse(start) + 60000)).toBe(Date.parse(later));
    const first = nextTimeout([work], {}, settings, Date.parse(later));
    expect(first).toBe(Date.parse(start) + 30 * 60000 + 1);
    expect(makeTracker().scan([work], {}, settings, first!).active.map(entry => entry.issue.id)).toEqual([1]);
    expect(nextTimeout([work], {}, settings, first!)).toBe(Date.parse(later) + 30 * 60000 + 1);
    expect(nextTimeout([work], {}, settings, Date.parse(later) + 31 * 60000)).toBe(Date.parse(history()[0]!.closed_at!) + 30 * 86400000 + 1);
  });
  it('requires a strict threshold crossing and known reliable start, never issue creation', () => {
    const tracker = makeTracker();
    expect(tracker.scan([lane()], {}, settings, Date.parse(start) + 30 * 60000).active).toHaveLength(0);
    const scan = tracker.scan([lane([issue(), issue(2, null), { ...issue(3), timerError: true }, issue(4, 'invalid'), issue(5, new Date(now + 60000).toISOString())])], {}, settings, now);
    expect(scan.active.map(entry => entry.issue.id)).toEqual([1]);
    expect(scan.active[0]).toMatchObject({ repo: 'sample/repo', elapsedMs: 31 * 60000 });
    expect(scan.newlyTimedOut).toHaveLength(1);
    expect(tracker.scan([lane()], {}, settings, now + 1000).newlyTimedOut).toHaveLength(0);
  });
  it('uses repository status overrides, closed state and changed thresholds immediately', () => {
    const tracker = makeTracker();
    const custom = lane([issue(1, start, 'working-now'), { ...issue(2), state: 'closed' }]);
    expect(tracker.scan([custom], {}, settings, now).active).toHaveLength(0);
    expect(tracker.scan([custom], { 'sample/repo': { progress: 'working-now' } }, { ...settings, timeoutOverrunPercent: 100 }, now).active).toHaveLength(0);
    expect(tracker.scan([custom], { 'sample/repo': { progress: 'working-now' } }, settings, now).active.map(entry => entry.issue.id)).toEqual([1]);
  });
  it('keeps the card marked for the whole work period, notifies once and again only for a new work period', () => {
    const tracker = makeTracker();
    const work = issue();
    expect(tracker.scan([lane([work])], {}, settings, now).newlyTimedOut).toHaveLength(1);
    const later = tracker.scan([lane([work])], {}, settings, now + 3600000);
    expect(later.active).toHaveLength(1);
    expect(later.newlyTimedOut).toHaveLength(0);
    tracker.scan([lane([{ ...work, labels: [] }])], {}, settings, now);
    expect(tracker.scan([lane([work])], {}, settings, now).newlyTimedOut).toHaveLength(1);
    const restarted = { ...work, startedAt: new Date(Date.parse(start) + 30000).toISOString() };
    expect(tracker.scan([lane([restarted])], {}, settings, now).newlyTimedOut).toHaveLength(1);
  });
  it('never repeats a notification because GitHub was unavailable or the timeline became unknown', () => {
    const tracker = makeTracker();
    tracker.scan([lane()], {}, settings, now);
    tracker.scan([], {}, settings, now);
    tracker.scan([lane([])], {}, settings, now);
    tracker.scan([{ ...lane(), error: 'offline' }], {}, settings, now);
    tracker.scan([lane([issue(1, null)])], {}, settings, now);
    tracker.scan([lane([{ ...issue(), timerError: true }])], {}, settings, now);
    const again = tracker.scan([lane()], {}, settings, now);
    expect(again.active).toHaveLength(1);
    expect(again.newlyTimedOut).toHaveLength(0);
  });
  it('suppresses initial cached OS notifications without hiding dashboard timeouts and batches new entries', () => {
    const tracker = makeTracker();
    const baseline = tracker.scan([lane([issue(), issue(2)])], {}, settings, now, { notify: false });
    expect(baseline.active).toHaveLength(2);
    expect(baseline.newlyTimedOut).toHaveLength(0);
    expect(tracker.scan([lane([issue(), issue(2), issue(3)])], {}, settings, now).newlyTimedOut.map(entry => entry.issue.id)).toEqual([3]);
    tracker.clear();
    expect(tracker.scan([lane()], {}, settings, now).active).toHaveLength(1);
  });
  it('validates percentages and migrates legacy minutes to defaults', () => {
    expect(DEFAULT_TIMEOUT_OVERRUN_PERCENT).toBe(25);
    for (const value of [-1, 0.5, 1001, Infinity, '', '1e2', true, {}, null]) expect(parseTimeoutOverrunPercent(value)).toBeNull();
    expect(parseTimeoutOverrunPercent('0')).toBe(0);
    expect(parseTimeoutOverrunPercent(1000)).toBe(1000);
    expect(normalizeTimeoutSettings({ timeoutMinutes: 120 })).toEqual({ timeoutEnabled: true, timeoutOverrunPercent: 25 });
  });
  it('uses a calibrated estimate, strict percentage tolerance, and no fixed-minute fallback', () => {
    const value = makeTracker(), defaults = normalizeTimeoutSettings({});
    const limit = Date.parse(start) + 37.5 * 60000;
    expect(value.scan([lane()], {}, defaults, limit).active).toEqual([]);
    expect(value.scan([lane()], {}, defaults, limit + 1).active[0]).toMatchObject({ estimatedMs: 30 * 60000, thresholdMs: 37.5 * 60000 });
    const insufficient = { ...lane(), issues: [issue()] };
    expect(value.scan([insufficient], {}, defaults, limit + 3600000).active).toEqual([]);
  });
  it('scales the allowed duration with issue size from the same calibrated history', () => {
    const large = { ...issue(2), body: '- Migrate database schema and preserve authentication settings.\n- Integrate a distributed API with concurrent locking and permissions.\n- Validate all storage migrations and recovery scenarios.' };
    const result = makeTracker().scan([lane([issue(), large])], {}, settings, now);
    expect(result.active.map(entry => entry.issue.id)).toEqual([1]);
  });
  it('clears flags and deadlines while disabled and silently re-baselines settings and reenable', () => {
    const value = makeTracker(), work = lane();
    expect(value.scan([work], {}, settings, now).newlyTimedOut).toHaveLength(1);
    const off = { ...settings, timeoutEnabled: false };
    expect(value.scan([work], {}, off, now).active).toEqual([]);
    expect(nextTimeout([work], {}, off, now)).toBeNull();
    expect(value.scan([work], {}, settings, now).newlyTimedOut).toEqual([]);
    const changed = { ...settings, timeoutOverrunPercent: 50 };
    value.scan([work], {}, changed, now);
    expect(value.scan([work], {}, settings, now).newlyTimedOut).toEqual([]);
    expect(new TimeoutTracker().scan([work], {}, settings, now).newlyTimedOut).toEqual([]);
    const lower = new TimeoutTracker();
    lower.scan([work], {}, changed, now);
    expect(lower.scan([work], {}, settings, now).newlyTimedOut).toEqual([]);
    const unavailable = { ...work, issues: work.issues.filter(item => item.state !== 'closed') };
    const restored = new TimeoutTracker();
    restored.scan([unavailable], {}, settings, now, { notify: false });
    expect(restored.scan([work], {}, settings, now).newlyTimedOut).toEqual([]);
  });
  it('schedules future starts and history expiry without flagging an unreliable start', () => {
    const future = new Date(now + 60000).toISOString();
    expect(nextTimeout([lane([issue(1, future)])], {}, settings, now)).toBe(Date.parse(future));
    const noActive = lane([]);
    expect(nextTimeout([noActive], {}, settings, now)).toBe(Date.parse(history()[0]!.closed_at!) + 30 * 86400000 + 1);
  });
});
