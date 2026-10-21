import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHub } from '../src/lib/github';
import { issueRepository, parseSubIssues, SubIssuesCache } from '../src/lib/sub-issues';
import { RELATIONS_TTL_MS } from '../src/lib/issue-relations';
import type { Issue } from '../src/lib/model';
const parent = { id: 1, number: 1, updated_at: '2026-10-21', html_url: 'https://github.com/a/one/issues/1', sub_issues_summary: { total: 2, completed: 1 } } as Issue;
const child = (id: number) => ({ ...parent, id, number: id, title: 'Child', state: 'open', labels: [], html_url: `https://github.com/b/two/issues/${id}` });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('lazy sub-issues', () => {
  it('paginates public REST, shares the pending/cache result and never fetches children separately', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([child(2)]), { headers: { link: '<https://api.github.com/repos/a/one/issues/1/sub_issues?per_page=100&page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify([child(3)])));
    vi.stubGlobal('fetch', fetch);
    const client = new GitHub(), result = client.subIssues('a/one', parent);
    expect(client.subIssues('a/one', parent)).toBe(result);
    expect((await result)?.map(entry => entry.issue.id)).toEqual([2, 3]);
    await client.subIssues('a/one', parent);
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const call of fetch.mock.calls) expect(new Headers(call[1]?.headers).has('authorization')).toBe(false);
    client.invalidateIssueRelations(['b/two']); await client.subIssues('a/one', parent);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockResolvedValueOnce(new Response('[]'));
    client.invalidateIssueRelations(['a/one']); await client.subIssues('a/one', parent);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('hides inaccessible or partially failed pagination instead of displaying a truncated list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([child(2)]), { headers: { link: '<https://api.github.com/repos/a/one/issues/1/sub_issues?page=2>; rel="next"' } }))
      .mockResolvedValueOnce(new Response('{"message":"Not found"}', { status: 404 })));
    expect(await new GitHub().subIssues('a/one', parent)).toBeNull();
  });
  it('rejects unsafe links, malformed states/labels and pull requests without making up statuses', () => {
    const good = { ...child(2), body: 'An unneeded description that must not be copied into the child metadata cache.' };
    const parsed = parseSubIssues([good, good, { ...child(3), html_url: 'javascript:alert(1)' }, { ...child(4), state: 'unknown' }, { ...child(5), labels: null }, { ...child(6), pull_request: {} }]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ repository: 'b/two', issue: { id: 2, title: 'Child', state: 'open' } });
    expect(parsed[0]?.issue).not.toHaveProperty('body');
    expect(issueRepository({ ...good, html_url: 'https://user@github.com/b/two/issues/2' })).toBeNull();
    expect(issueRepository({ ...good, html_url: 'https://github.com/b/two/issues/999' })).toBeNull();
  });
  it('revalidates after parent/summary changes, expiry or manual refresh', async () => {
    vi.useFakeTimers(); const load = vi.fn(async () => []); const cache = new SubIssuesCache(load);
    await cache.get('a/one', parent); await cache.get('a/one', parent); expect(load).toHaveBeenCalledTimes(1);
    await cache.get('a/one', { ...parent, sub_issues_summary: { total: 3, completed: 1 } }); expect(load).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RELATIONS_TTL_MS); await cache.get('a/one', parent); expect(load).toHaveBeenCalledTimes(3);
    cache.clear(); await cache.get('a/one', parent); expect(load).toHaveBeenCalledTimes(4);
  });
});
