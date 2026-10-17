import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEOUT_MINUTES, parseTimeoutMinutes, TimeoutTracker } from '../src/lib/timeouts';
import type { Issue, Lane } from '../src/lib/model';
const start = '2026-10-16T10:00:00Z';
const now = Date.parse(start) + 31 * 60000;
function issue(id = 1, startedAt: string | null = start, label = 'in-progress'): Issue {
  return { id, number: id, title: 'Fixture', state: 'open', html_url: `https://github.com/sample/repo/issues/${id}`, created_at: '2020-01-01T00:00:00Z', updated_at: start, closed_at: null, labels: [{ name: label, color: '000000' }], assignees: [], startedAt };
}
function lane(issues = [issue()]): Lane { return { repo: { id: 1, full_name: 'sample/repo' } as Lane['repo'], issues, labels: [] }; }
describe('timeouts follow actual continuous work periods', () => {
  it('requires a strict threshold crossing and known reliable start, never issue creation', () => {
    const tracker = new TimeoutTracker();
    expect(tracker.scan([lane()], {}, 30, Date.parse(start) + 30 * 60000).active).toHaveLength(0);
    const scan = tracker.scan([lane([issue(), issue(2, null), { ...issue(3), timerError: true }, issue(4, 'invalid'), issue(5, new Date(now + 60000).toISOString())])], {}, 30, now);
    expect(scan.active.map(entry => entry.issue.id)).toEqual([1]);
    expect(scan.active[0]).toMatchObject({ repo: 'sample/repo', elapsedMs: 31 * 60000 });
    expect(scan.newlyTimedOut).toHaveLength(1);
    expect(tracker.scan([lane()], {}, 30, now + 1000).newlyTimedOut).toHaveLength(0);
  });
  it('uses repository status overrides, closed state and changed thresholds immediately', () => {
    const tracker = new TimeoutTracker();
    const custom = lane([issue(1, start, 'working-now'), { ...issue(2), state: 'closed' }]);
    expect(tracker.scan([custom], {}, 30, now).active).toHaveLength(0);
    expect(tracker.scan([custom], { 'sample/repo': { progress: 'working-now' } }, 60, now).active).toHaveLength(0);
    expect(tracker.scan([custom], { 'sample/repo': { progress: 'working-now' } }, 20, now).active.map(entry => entry.issue.id)).toEqual([1]);
  });
  it('keeps the card marked for the whole work period, notifies once and again only for a new work period', () => {
    const tracker = new TimeoutTracker();
    const work = issue();
    expect(tracker.scan([lane([work])], {}, 30, now).newlyTimedOut).toHaveLength(1);
    const later = tracker.scan([lane([work])], {}, 30, now + 3600000);
    expect(later.active).toHaveLength(1);
    expect(later.newlyTimedOut).toHaveLength(0);
    tracker.scan([lane([{ ...work, labels: [] }])], {}, 30, now);
    expect(tracker.scan([lane([work])], {}, 30, now).newlyTimedOut).toHaveLength(1);
    const restarted = { ...work, startedAt: new Date(Date.parse(start) + 60000).toISOString() };
    expect(tracker.scan([lane([restarted])], {}, 1, now).newlyTimedOut).toHaveLength(1);
  });
  it('never repeats a notification because GitHub was unavailable or the timeline became unknown', () => {
    const tracker = new TimeoutTracker();
    tracker.scan([lane()], {}, 30, now);
    tracker.scan([], {}, 30, now);
    tracker.scan([lane([])], {}, 30, now);
    tracker.scan([{ ...lane(), error: 'offline' }], {}, 30, now);
    tracker.scan([lane([issue(1, null)])], {}, 30, now);
    tracker.scan([lane([{ ...issue(), timerError: true }])], {}, 30, now);
    const again = tracker.scan([lane()], {}, 30, now);
    expect(again.active).toHaveLength(1);
    expect(again.newlyTimedOut).toHaveLength(0);
  });
  it('suppresses initial cached OS notifications without hiding dashboard timeouts and batches new entries', () => {
    const tracker = new TimeoutTracker();
    const baseline = tracker.scan([lane([issue(), issue(2)])], {}, 30, now, { notify: false });
    expect(baseline.active).toHaveLength(2);
    expect(baseline.newlyTimedOut).toHaveLength(0);
    expect(tracker.scan([lane([issue(), issue(2), issue(3)])], {}, 30, now).newlyTimedOut.map(entry => entry.issue.id)).toEqual([3]);
    tracker.clear();
    expect(tracker.scan([lane()], {}, 30, now).active).toHaveLength(1);
  });
  it('validates timeout bounds', () => {
    expect(DEFAULT_TIMEOUT_MINUTES).toBe(30);
    for (const value of [0, -1, 0.5, 10081, Infinity, '', '1e2', true, {}, null]) expect(parseTimeoutMinutes(value)).toBeNull();
    expect(parseTimeoutMinutes('45')).toBe(45);
    expect(parseTimeoutMinutes(10080)).toBe(10080);
  });
});
