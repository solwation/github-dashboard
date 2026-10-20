import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatisticsCollector, STATISTICS_PREVIEW_INTERVAL_MS, type StatisticsClient } from '../src/lib/statistics-client';
import { StatisticsPreviewBatch } from '../src/lib/statistics-progress';
import type { StatisticsData } from '../src/lib/statistics';
const now = Date.parse('2026-10-20T12:00:00Z');
const issue = (id: number) => ({ id, number: id, created_at: '2026-10-20T01:00:00Z', updated_at: '2026-10-20T02:00:00Z', labels: [] });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type Reply = { data: unknown; next: string | null };
const denied = () => Object.assign(new Error('fixture denied'), { status: 403, permissionDenied: true });
function client(handler: (url: URL) => Promise<Reply> | Reply): StatisticsClient {
  return { async request<T>(path: string) { return await handler(new URL(path, 'https://api.github.com')) as { data: T; next: string | null }; } };
}
afterEach(() => vi.useRealTimers());
describe('batched statistics previews', () => {
  it('coalesces page updates, detaches snapshots, serves joined listeners and never exports a draft', async () => {
    vi.useFakeTimers();
    const secondPage = deferred<Reply>(), lastPage = deferred<Reply>(), events = deferred<Reply>();
    const collector = new StatisticsCollector(client(url => {
      if (url.pathname.endsWith('/issues/events')) return events.promise;
      if (url.pathname.endsWith('/issues')) return url.searchParams.get('page') === '2' ? secondPage.promise : url.searchParams.get('page') === '3' ? lastPage.promise
        : { data: [issue(1), { ...issue(100), pull_request: {} }], next: '/repos/sample/period/issues?page=2' };
      throw denied();
    }));
    const seen: StatisticsData[] = [], joined: StatisticsData[] = [];
    const work = collector.load('sample/period', now, false, snapshot => seen.push(snapshot));
    await vi.advanceTimersByTimeAsync(STATISTICS_PREVIEW_INTERVAL_MS - 1);
    expect(seen).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.issues!.data.map(item => item.id)).toEqual([1]);
    expect(seen[0]!.issues!.complete).toBe(false);
    expect(seen[0]!.commits).toBeNull();
    expect(collector.export()).toEqual([]);
    const other = collector.load('sample/period', now, false, snapshot => joined.push(snapshot));
    expect(joined[0]).toBe(seen[0]);
    secondPage.resolve({ data: [issue(2)], next: '/repos/sample/period/issues?page=3' });
    await vi.advanceTimersByTimeAsync(499);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.issues!.data).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toHaveLength(2);
    expect(joined).toHaveLength(2);
    expect(seen[1]!.issues!.data).toHaveLength(2);
    lastPage.resolve({ data: [issue(3)], next: null });
    events.resolve({ data: [], next: null });
    const result = await work;
    expect(await other).toBe(result);
    expect(result.issues!.data).toHaveLength(3);
    expect(result.issues!.complete).toBe(true);
    expect(collector.export()).toEqual([result]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toHaveLength(2);
  });

  it('cancels queued previews on dispose and isolates a late old-session response', async () => {
    vi.useFakeTimers();
    const events = deferred<Reply>();
    const listener = vi.fn();
    const collector = new StatisticsCollector(client(url => url.pathname.endsWith('/issues/events') ? events.promise : { data: [issue(1)], next: null }));
    const work = collector.load('sample/period', now, false, listener);
    await vi.advanceTimersByTimeAsync(100);
    collector.dispose();
    events.resolve({ data: [], next: null });
    await work;
    await vi.advanceTimersByTimeAsync(2000);
    expect(listener).not.toHaveBeenCalled();
    expect(collector.export()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a foreground subscriber to join a background load that started without previews', async () => {
    vi.useFakeTimers();
    const events = deferred<Reply>();
    const collector = new StatisticsCollector(client(url => {
      if (url.pathname.endsWith('/issues/events')) return events.promise;
      if (url.pathname.endsWith('/issues')) return { data: [issue(1)], next: null };
      throw denied();
    }));
    const work = collector.load('sample/period', now);
    await vi.advanceTimersByTimeAsync(1000);
    const listener = vi.fn();
    const joined = collector.load('sample/period', now, false, listener);
    await vi.advanceTimersByTimeAsync(500);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].issues.data).toHaveLength(1);
    events.resolve({ data: [], next: null });
    expect(await joined).toBe(await work);
  });

  it('preserves unrefreshed sources and prior records until final replacement, but hides revoked sources', async () => {
    vi.useFakeTimers();
    let refresh = false;
    const secondPage = deferred<Reply>(), events = deferred<Reply>();
    const collector = new StatisticsCollector(client(url => {
      if (url.pathname.endsWith('/issues/events')) return refresh ? events.promise : { data: [], next: null };
      if (url.pathname.endsWith('/issues')) return !refresh ? { data: [issue(1)], next: null } : url.searchParams.has('page') ? secondPage.promise : { data: [issue(2)], next: '/repos/sample/period/issues?page=2' };
      if (refresh) throw denied();
      return { data: [], next: null };
    }));
    const original = await collector.load('sample/period', now);
    refresh = true;
    const listener = vi.fn();
    const work = collector.load('sample/period', now + 1000, true, listener);
    await vi.advanceTimersByTimeAsync(500);
    const preview: StatisticsData = listener.mock.calls[0]![0];
    expect(preview.issues!.data.map(item => item.id)).toEqual([1, 2]);
    expect(preview.issues!.complete).toBe(false);
    expect(preview.events).toEqual(original.events);
    expect(preview.commits).toBeNull();
    expect(preview.changes).toBeNull();
    expect(collector.export()).toEqual([original]);
    secondPage.resolve({ data: [], next: null }); events.resolve({ data: [], next: null });
    const final = await work;
    expect(final.issues!.data.map(item => item.id)).toEqual([2]);
    expect(final.commits).toBeNull();
  });
});

it('batches staggered repository previews globally and discards completed or old-session data', async () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const batch = new StatisticsPreviewBatch(publish);
  const snapshot = { repository: 'sample/one' } as StatisticsData;
  batch.add('sample/one', snapshot);
  await vi.advanceTimersByTimeAsync(200);
  batch.add('sample/two', { ...snapshot, repository: 'sample/two' });
  batch.discard('sample/one');
  await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(Object.keys(publish.mock.calls[0]![0])).toEqual(['sample/two']);
  batch.add('sample/three', snapshot);
  batch.clear();
  await vi.advanceTimersByTimeAsync(1000);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('collapses a burst of 99 event pages into one preview', async () => {
  vi.useFakeTimers();
  const last = deferred<Reply>();
  const collector = new StatisticsCollector(client(url => {
    if (!url.pathname.endsWith('/issues/events')) throw denied();
    const page = Number(url.searchParams.get('page') || 1);
    if (page === 100) return last.promise;
    return { data: [{ id: page, event: 'closed', created_at: '2026-10-20T01:00:00Z', issue: issue(1) }], next: `/repos/sample/period/issues/events?page=${page + 1}` };
  }));
  const listener = vi.fn();
  const work = collector.load('sample/period', now, false, listener);
  await vi.advanceTimersByTimeAsync(500);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]![0].events.data).toHaveLength(99);
  last.resolve({ data: [], next: null });
  await work;
  await vi.advanceTimersByTimeAsync(1000);
  expect(listener).toHaveBeenCalledTimes(1);
});
