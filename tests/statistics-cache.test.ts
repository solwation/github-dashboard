import { beforeEach, describe, expect, it, vi } from 'vitest';
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../src/lib/vault', () => ({ loadStatistics: load, saveStatistics: save }));
import { parseStatisticsCache, previewStatistics, readStatisticsCache, writeStatisticsCache, STATISTICS_RETENTION_MS } from '../src/lib/statistics-cache';
import { statisticsWindow, type StatisticsData } from '../src/lib/statistics';
const now = Date.parse('2026-10-16T15:00:00Z');
function entry(repository = 'sample/repo'): StatisticsData {
  return { repository, ...statisticsWindow(now), fetchedAt: now, issues: { data: [], complete: true, fetchedAt: now }, events: null, commits: { data: [], complete: true, fetchedAt: now, historyVerifiedAt: now }, changes: null, pulls: null, temporary: [] };
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
    expect(preview.from).toBe('2026-09-19'); expect(preview.to).toBe('2026-10-18');
    expect(preview.issues!.complete).toBe(false); expect(preview.commits!.complete).toBe(false);
    expect(preview.fetchedAt).toBe(now);
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
});
