import { describe, expect, it, vi } from 'vitest';
import { MAX_PUBLIC_CONTENT_BYTES, MAX_PUBLIC_CONTENT_LANES, PUBLIC_CONTENT_ACCOUNT, PUBLIC_CONTENT_LIFETIME_MS, normalizePublicContent, readPublicContent, writePublicContent } from '../src/lib/public-content-cache';
import { loadSettings, saveSettings } from '../src/lib/settings-store';
import type { Lane } from '../src/lib/model';
vi.mock('../src/lib/settings-store', () => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
const now = Date.parse('2026-10-21T12:00:00Z');
function lane(id = 1): Lane {
  return { repo: { id, name: `repo-${id}`, full_name: `sample/repo-${id}`, private: false, owner: { login: 'sample' }, html_url: `https://github.com/sample/repo-${id}`, description: null }, labels: [],
    issues: [{ id, number: 1, title: 'Complete public issue', state: 'open', html_url: `https://github.com/sample/repo-${id}/issues/1`, created_at: new Date(now - 3600000).toISOString(), updated_at: new Date(now - 60000).toISOString(), closed_at: null, labels: [], assignees: [] }] };
}
const snapshot = (entries: unknown[]) => ({ version: 1, entries });
describe('bounded public content snapshots', () => {
  it('retains original successful sync times and drops expired, future or malformed entries', () => {
    const syncedAt = now - 60000;
    expect(normalizePublicContent(snapshot([{ lane: lane(), syncedAt }]), now)).toEqual([{ lane: lane(), syncedAt }]);
    for (const value of [null, {}, { version: 2, entries: [] }, snapshot([{ lane: lane(), syncedAt: now + 1 }]), snapshot([{ lane: lane(), syncedAt: now - PUBLIC_CONTENT_LIFETIME_MS }]), snapshot([{ lane: lane(), syncedAt: 'yesterday' }])]) expect(normalizePublicContent(value, now)).toEqual([]);
    const written = normalizePublicContent(snapshot([{ lane: lane(), syncedAt }]), now + 1000);
    expect(written[0]?.syncedAt).toBe(syncedAt);
    expect(normalizePublicContent(snapshot(written), syncedAt + PUBLIC_CONTENT_LIFETIME_MS)).toEqual([]);
  });
  it('rejects entire incomplete/private lanes rather than showing a partial or empty success', () => {
    const original = lane();
    const invalid = [ { ...original, loading: true }, { ...original, error: 'Quota exceeded' }, { ...original, repo: { ...original.repo, private: true } },
      { ...original, issues: [{ ...original.issues[0], labels: null }] }, { ...original, issues: [{ ...original.issues[0], state: 'closed', closed_at: null }] },
      { ...original, issues: [...original.issues, { id: 3 }] }, { ...original, issues: [...original.issues, ...original.issues] } ];
    for (const value of invalid) expect(normalizePublicContent(snapshot([{ lane: value, syncedAt: now }]), now)).toEqual([]);
    expect(normalizePublicContent(snapshot([{ lane: { ...original, issues: [] }, syncedAt: now }]), now)).toHaveLength(1);
  });
  it('expires old closed issues while retaining open issues and the 30-day boundary', () => {
    const value = lane();
    const closed = (id: number, days: number) => ({ ...value.issues[0]!, id, number: id, state: 'closed', closed_at: new Date(now - days * 86400000).toISOString() });
    value.issues.push(closed(2, 30), closed(3, 30.01));
    expect(normalizePublicContent(snapshot([{ lane: value, syncedAt: now - 3600000 }]), now)[0]!.lane.issues.map(item => item.id)).toEqual([1, 2]);
  });
  it('budgets UTF-8 bytes and whole lanes, bounds count, and prefers newer duplicate repositories', () => {
    const large = lane(); large.issues[0]!.body = 'ö'.repeat(MAX_PUBLIC_CONTENT_BYTES);
    const small = lane(2);
    const result = normalizePublicContent(snapshot([{ lane: large, syncedAt: now }, { lane: small, syncedAt: now - 1 }]), now);
    expect(result.map(entry => entry.lane.repo.id)).toEqual([2]);
    expect(new TextEncoder().encode(JSON.stringify(snapshot(result))).byteLength).toBeLessThanOrEqual(MAX_PUBLIC_CONTENT_BYTES);
    expect(normalizePublicContent(snapshot(Array.from({ length: 120 }, (_, i) => ({ lane: lane(i + 1), syncedAt: now - i }))), now)).toHaveLength(MAX_PUBLIC_CONTENT_LANES);
    expect(normalizePublicContent(snapshot([{ lane: lane(), syncedAt: now - 2 }, { lane: lane(), syncedAt: now - 1 }]), now).map(entry => entry.syncedAt)).toEqual([now - 1]);
  });
  it('uses only the encrypted reserved public record and treats storage failure as a cache miss', async () => {
    vi.mocked(loadSettings).mockResolvedValueOnce(snapshot([{ lane: lane(), syncedAt: now }]));
    expect(await readPublicContent(now)).toHaveLength(1);
    expect(loadSettings).toHaveBeenLastCalledWith(PUBLIC_CONTENT_ACCOUNT);
    vi.mocked(loadSettings).mockRejectedValueOnce(new Error('Unavailable'));
    expect(await readPublicContent(now)).toEqual([]);
    vi.mocked(saveSettings).mockResolvedValueOnce();
    await writePublicContent([{ lane: lane(), syncedAt: now - 1000 }], now);
    expect(saveSettings).toHaveBeenLastCalledWith(PUBLIC_CONTENT_ACCOUNT, snapshot([{ lane: lane(), syncedAt: now - 1000 }]));
  });
});
