import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatisticsLoadTracker } from '../src/lib/statistics-load-status';
import { StatisticsCollector, type StatisticsClient } from '../src/lib/statistics-client';
import { StatisticsPreviewBatch } from '../src/lib/statistics-progress';
import type { StatisticsData } from '../src/lib/statistics';
const until = Date.parse('2026-10-20T12:00:00Z');
const window = { from: '2026-09-20', to: '2026-10-20' };
afterEach(() => vi.useRealTimers());

describe('honest collection status', () => {
  it('distinguishes sparse old activity, processed sources and complete coverage without inventing percent or ETA', () => {
    const tracker = new StatisticsLoadTracker(window, until);
    tracker.observe('2026-09-30T12:00:00Z');
    tracker.sourceDone('events', false);
    tracker.sourceDone('issues', true);
    const status = tracker.snapshot();
    expect(status.sourcesDone).toBe(2);
    expect(status.completeSources).toBe(1);
    expect(status.reachedDays).toBe(20);
    expect(status.percent).toBeUndefined();
    expect(status.remainingMs).toBeUndefined();
    expect(status.phase).toBe('lists');
    expect(status.collectionFrom).toBe('2026-09-20T00:00:00Z');
    expect(status.collectionTo).toBe('2026-10-20T12:00:00.000Z');
  });
  it('treats empty complete sources as complete without inventing activity, and ignores out-of-window records', () => {
    const tracker = new StatisticsLoadTracker(window, until);
    for (const source of ['issues', 'events', 'commits', 'pulls'] as const) tracker.sourceDone(source, true);
    for (const date of ['invalid', '2020-01-01T00:00:00Z', '2026-10-21T00:00:00Z']) tracker.observe(date);
    expect(tracker.snapshot()).toMatchObject({ sourcesDone: 4, completeSources: 4 });
    expect(tracker.snapshot().oldestActivityAt).toBeUndefined();
    expect(tracker.snapshot().reachedDays).toBeUndefined();
  });
  it('reports a known diff denominator but estimates only after three fresh completions and two seconds', () => {
    let now = 0;
    const tracker = new StatisticsLoadTracker(window, until, () => now);
    tracker.startChanges(10, 4);
    for (let n = 0; n < 4; n++) tracker.diffDone(false);
    now = 10_000;
    expect(tracker.snapshot()).toMatchObject({ phase: 'changes', diffsDone: 4, diffsTotal: 10, percent: 40 });
    expect(tracker.snapshot().remainingMs).toBeUndefined();
    tracker.diffDone(true); tracker.diffDone(true);
    expect(tracker.snapshot().remainingMs).toBeUndefined();
    tracker.diffDone(true);
    expect(tracker.snapshot()).toMatchObject({ diffsDone: 7, percent: 70, remainingMs: 10_000 });
    for (let n = 0; n < 3; n++) tracker.diffDone(true);
    expect(tracker.snapshot()).toMatchObject({ diffsDone: 10, percent: 100 });
    expect(tracker.snapshot().remainingMs).toBeUndefined();
  });
  it('withholds ETA for fast samples and gives a new run independent counters', () => {
    let now = 0;
    const tracker = new StatisticsLoadTracker(window, until, () => now);
    tracker.startChanges(5, 0);
    tracker.diffDone(true); tracker.diffDone(true); tracker.diffDone(true);
    now = 1999;
    expect(tracker.snapshot().remainingMs).toBeUndefined();
    now = 2000;
    expect(tracker.snapshot().remainingMs).toBe(1334);
    expect(new StatisticsLoadTracker(window, until).snapshot()).toMatchObject({ phase: 'lists', sourcesDone: 0, completeSources: 0 });
  });
});

it('batches matching status with data, replaces newer status and discards completed repositories', async () => {
  vi.useFakeTimers();
  const publish = vi.fn();
  const batch = new StatisticsPreviewBatch(publish);
  const tracker = new StatisticsLoadTracker(window, until);
  const data = { repository: 'sample/one' } as StatisticsData;
  batch.add('sample/one', data, tracker.snapshot());
  tracker.sourceDone('issues', true);
  batch.add('sample/one', data, tracker.snapshot());
  batch.add('sample/two', data, tracker.snapshot()); batch.discard('sample/two');
  await vi.advanceTimersByTimeAsync(500);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0]![0]).toEqual({ 'sample/one': data });
  expect(publish.mock.calls[0]![1]).toMatchObject({ 'sample/one': { sourcesDone: 1 } });
  expect(Object.keys(publish.mock.calls[0]![1])).toEqual(['sample/one']);
  batch.add('sample/one', data, tracker.snapshot()); batch.clear();
  await vi.advanceTimersByTimeAsync(500);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('delivers source discovery and timed diff work through the existing timer without persisting progress', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(until);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const issue = { id: 1, number: 1, created_at: '2026-09-30T12:00:00Z', updated_at: '2026-10-20T01:00:00Z', labels: [] };
  const commits = Array.from({ length: 6 }, (_, id) => ({ sha: `diff-${id}`, parents: [{ sha: 'parent' }], commit: { committer: { date: '2026-10-20T01:00:00Z' } } }));
  const client: StatisticsClient = { async request<T>(path: string) {
    const url = new URL(path, 'https://api.github.com');
    let data: unknown = [];
    if (url.pathname.endsWith('/issues/events')) await gate;
    else if (url.pathname.endsWith('/issues')) data = [issue];
    else if (url.pathname.endsWith('/commits')) data = commits;
    else if (url.pathname.includes('/commits/')) {
      await new Promise(resolve => setTimeout(resolve, 2200));
      data = { stats: { additions: 1, deletions: 1 }, files: [{ filename: 'file.ts' }] };
    }
    return { data: data as T, next: null };
  } };
  const collector = new StatisticsCollector(client);
  const listener = vi.fn();
  const work = collector.load('sample/one', until, false, listener);
  await vi.advanceTimersByTimeAsync(500);
  expect(listener.mock.calls[0]![1]).toMatchObject({ phase: 'lists', sourcesDone: 3, completeSources: 3, reachedDays: 20 });
  expect(listener.mock.calls[0]![1].percent).toBeUndefined();
  const joined = vi.fn();
  const sameWork = collector.load('sample/one', until, false, joined);
  expect(joined.mock.calls[0]![1]).toBe(listener.mock.calls[0]![1]);
  release();
  await vi.advanceTimersByTimeAsync(500);
  expect(listener.mock.calls.at(-1)![1]).toMatchObject({ phase: 'changes', diffsDone: 0, diffsTotal: 6, percent: 0 });
  await vi.advanceTimersByTimeAsync(2200);
  expect(listener.mock.calls.at(-1)![1]).toMatchObject({ phase: 'changes', diffsDone: 3, diffsTotal: 6, percent: 50 });
  expect(listener.mock.calls.at(-1)![1].remainingMs).toBeGreaterThanOrEqual(2200);
  expect(collector.export()).toEqual([]);
  await vi.advanceTimersByTimeAsync(2200);
  const final = await work;
  expect(await sameWork).toBe(final);
  expect(JSON.stringify(final)).not.toMatch(/sourcesDone|remainingMs|diffsDone|oldestActivityAt/);
  expect(collector.export()).toEqual([final]);
});

it('retains old complete chart data after a failed refresh without claiming it was freshly collected', async () => {
  vi.useFakeTimers();
  let refreshing = false, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const client: StatisticsClient = { async request<T>(path: string) {
    if (refreshing && path.includes('/issues?')) throw new Error('temporary fixture failure');
    if (refreshing && path.includes('/issues/events')) await blocked;
    return { data: [] as T, next: null };
  } };
  const collector = new StatisticsCollector(client);
  const original = await collector.load('sample/one', until);
  refreshing = true;
  const listener = vi.fn();
  const work = collector.load('sample/one', until + 1000, true, listener);
  await vi.advanceTimersByTimeAsync(500);
  expect(listener.mock.calls[0]![0].issues.complete).toBe(true);
  expect(listener.mock.calls[0]![1]).toMatchObject({ phase: 'lists', sourcesDone: 3, completeSources: 2 });
  expect(collector.export()).toEqual([original]);
  release(); await work;
});
