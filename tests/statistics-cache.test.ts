import { beforeEach, describe, expect, it, vi } from 'vitest';
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../src/lib/vault', () => ({ loadStatistics: load, saveStatistics: save }));
import { parseStatisticsCache, previewStatistics, readStatisticsCache, writeStatisticsCache, STATISTICS_RETENTION_MS } from '../src/lib/statistics-cache';
import { statisticsCollectionWindow, statisticsWindow, summarizeStatistics, type StatisticsData } from '../src/lib/statistics';
import { StatisticsCollector, type StatisticsClient } from '../src/lib/statistics-client';
const now = Date.parse('2026-10-16T15:00:00Z');
function entry(repository = 'sample/repo'): StatisticsData {
  return { repository, ...statisticsCollectionWindow(now), fetchedAt: now, issues: { data: [], complete: true, fetchedAt: now }, events: null, commits: { data: [], complete: true, fetchedAt: now, historyVerifiedAt: now }, changes: null, pulls: null, temporary: [] };
}
beforeEach(() => { load.mockReset(); save.mockReset().mockResolvedValue(undefined); });
describe('bounded credential-bound statistics snapshots', () => {
  it('accepts bounded fresh sources but drops obsolete, malformed and oversized data', () => {
    const valid = entry();
    expect(parseStatisticsCache({ version: 1, repositories: [valid] }, now)).toHaveLength(1);
    expect(parseStatisticsCache({ version: 2, repositories: [valid] }, now)).toEqual([]);
    expect(parseStatisticsCache({ version: 1, repositories: [{ ...valid, fetchedAt: now - STATISTICS_RETENTION_MS }] }, now)).toEqual([]);
    expect(parseStatisticsCache({ version: 1, repositories: [{ ...valid, repository: '../invalid' }] }, now)).toEqual([]);
    const broken = { ...valid, issues: { ...valid.issues, data: [{ id: 1 }] }, commits: { ...valid.commits, data: [null] } };
    const parsed = parseStatisticsCache({ version: 1, repositories: [broken] }, now)[0]!;
    expect(parsed.issues).toBeNull(); expect(parsed.commits).toBeNull();
    const expired = { ...valid, issues: { ...valid.issues, fetchedAt: now - STATISTICS_RETENTION_MS } };
    expect(parseStatisticsCache({ version: 1, repositories: [expired] }, now)[0]!.issues).toBeNull();
  });
  it('never labels missing new days as complete during immediate cached preview', () => {
    const preview = previewStatistics(entry(), now + 2 * 86400000);
    expect(preview.from).toBe('2026-09-18'); expect(preview.to).toBe('2026-10-18');
    expect(preview.issues!.complete).toBe(false); expect(preview.commits!.complete).toBe(false);
    expect(preview.fetchedAt).toBe(now);
  });
  it('preserves old thirty-day snapshots as partial until the missing source day is fetched', () => {
    const legacy = { ...entry(), ...statisticsWindow(now) };
    const parsed = parseStatisticsCache({ version: 1, repositories: [legacy] }, now)[0]!;
    expect(parsed.from).toBe(legacy.from);
    expect(parsed.issues!.complete).toBe(false);
    expect(parsed.commits!.complete).toBe(false);
    expect(previewStatistics(parsed, now).issues!.complete).toBe(false);
    const full = parseStatisticsCache({ version: 1, repositories: [entry()] }, now)[0]!;
    expect(full.issues!.complete).toBe(true);
    expect(full.commits!.complete).toBe(true);
    // Parsing never mutates the authenticated snapshot supplied by the caller.
    expect(legacy.issues!.complete).toBe(true);
  });
  it('keeps filters out of the raw repository cache, compacts unused private fields and bounds repository count', async () => {
    const data = entry();
    data.issues!.data = [{ id: 1, number: 1, created_at: '2026-10-15', updated_at: '2026-10-15', labels: [], body: 'unused large description' } as never];
    await writeStatisticsCache('credential-fixture', [data, ...Array.from({ length: 12 }, (_, index) => entry(`sample/repo${index}`))]);
    expect(save.mock.calls[0]![0]).toBe('credential-fixture');
    expect(save.mock.calls[0]![1].repositories).toHaveLength(10);
    await writeStatisticsCache('credential-fixture', [data]);
    expect(JSON.stringify(save.mock.calls[1]![1])).not.toContain('unused large description');
    expect(JSON.stringify(save.mock.calls[1]![1])).not.toContain('credential-fixture');
  });
  it('keeps only the label name of issue events so the board can derive closed work starts (#141)', async () => {
    const data = entry();
    const issue = { id: 7, number: 7, created_at: '2026-10-15', updated_at: '2026-10-15', labels: [] };
    data.events = { data: [{ id: 1, event: 'labeled', created_at: '2026-10-15T10:00:00Z', issue, label: { name: 'in-progress', color: 'fff' } } as never, { id: 2, event: 'closed', created_at: '2026-10-15T11:00:00Z', issue }], complete: true, fetchedAt: now };
    await writeStatisticsCache('credential-fixture', [data]);
    const stored = save.mock.calls[0]![1];
    expect(stored.repositories[0].events.data.map((event: { label?: unknown }) => event.label)).toEqual([{ name: 'in-progress' }, undefined]);
    expect(parseStatisticsCache(stored, now)[0]!.events!.data[0]!.label).toEqual({ name: 'in-progress' });
  });
  it('evicts older repositories to stay within the encrypted JSON byte budget instead of truncating complete source data', async () => {
    const large = (repository: string) => {
      const data = entry(repository);
      data.issues!.data = [{ id: 1, number: 1, created_at: '2026-10-15', updated_at: '2026-10-15', labels: [{ name: 'x'.repeat(5 * 1024 * 1024) }] }];
      return data;
    };
    await writeStatisticsCache('credential-fixture', [large('sample/older'), large('sample/newer')]);
    const saved = save.mock.calls[0]![1];
    expect(saved.repositories.map((data: StatisticsData) => data.repository)).toEqual(['sample/newer']);
    expect(new TextEncoder().encode(JSON.stringify(saved)).byteLength).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(saved.repositories[0].issues.complete).toBe(true);
  });
  it('rejects unverified historical coverage and does not keep orphaned code metrics', () => {
    const data = entry();
    delete data.commits!.historyVerifiedAt;
    expect(parseStatisticsCache({ version: 1, repositories: [data] }, now)[0]!.commits!.complete).toBe(false);
    data.commits = null;
    data.changes = { data: [{ sha: 'orphaned', date: '2026-10-10', contributor: 'sample', additions: 10, deletions: 3, files: 1, filesComplete: true }], fetchedAt: now, complete: true };
    expect(parseStatisticsCache({ version: 1, repositories: [data] }, now)[0]!.changes).toBeNull();
  });
  it('treats damaged or inaccessible encrypted records as a cold cache without leaking across credentials', async () => {
    load.mockRejectedValueOnce(new Error('damaged'));
    expect(await readStatisticsCache('token-a', now)).toEqual([]);
    load.mockResolvedValueOnce(null);
    expect(await readStatisticsCache('token-b', now)).toEqual([]);
    expect(load.mock.calls.map(call => call[0])).toEqual(['token-a', 'token-b']);
  });
  it('round-trips snapshot built from more than 300 board issues without dropping issues source (#322)', async () => {
    const issues = Array.from({ length: 350 }, (_, i) => ({
      id: i + 1,
      number: i + 1,
      created_at: '2026-10-10T00:00:00Z',
      updated_at: new Date(Date.parse('2026-10-10T00:00:00Z') + i * 1000).toISOString(),
      labels: [{ name: 'bug' }],
    }));
    const client: StatisticsClient = {
      async request<T>() { return { data: [] as unknown as T, next: null }; },
      boardIssues() { return issues; },
    };
    const collector = new StatisticsCollector(client);
    const snapshot = await collector.load('sample/repo', now);
    expect(snapshot.issues).not.toBeNull();
    expect(snapshot.issues!.data).toHaveLength(300);
    expect(snapshot.issues!.complete).toBe(false);
    expect(snapshot.issues!.data[0]!.id).toBe(350);

    await writeStatisticsCache('credential-fixture', [snapshot]);
    const stored = save.mock.calls[0]![1];
    const parsed = parseStatisticsCache(stored, now);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.issues).not.toBeNull();
    expect(parsed[0]!.issues!.data).toHaveLength(300);
    expect(parsed[0]!.issues!.complete).toBe(false);
    expect(parsed[0]!.issues!.data[0]!.id).toBe(350);

    const summary = summarizeStatistics(parsed, { from: snapshot.from, to: snapshot.to, label: '', contributor: '' });
    expect(summary.complete.created).toBe(false);
    expect(summary.complete.netIssues).toBe(false);
    expect(summary.totals.created).toBe(300);

    // If revalidation fails, restored cached data provides fallback issues
    const restoredCollector = new StatisticsCollector({
      async request() { throw new Error('offline'); },
      boardIssues() { return null; },
    });
    restoredCollector.restore(parsed);
    const fallback = await restoredCollector.load('sample/repo', now + 1000);
    expect(fallback.issues).not.toBeNull();
    expect(fallback.issues!.data).toHaveLength(300);
    expect(fallback.issues!.complete).toBe(false);
  });
});
