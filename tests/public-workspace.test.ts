import { describe, expect, it, vi, afterEach } from 'vitest';
import { publicRepositoryName, publicRepositoryRecord, PUBLIC_SETTINGS_ACCOUNT } from '../src/lib/public-workspace';
import { GitHub } from '../src/lib/github';
import type { Issue, Repo } from '../src/lib/model';
afterEach(() => vi.unstubAllGlobals());
describe('public repository input', () => {
  it('accepts names and canonical URLs without permitting arbitrary hosts or traversal', () => {
    for (const input of ['sample/project', ' https://github.com/sample/project/ ', 'https://github.com/sample/project.git']) expect(publicRepositoryName(input)).toBe('sample/project');
    for (const input of ['project', 'sample/../private', 'sample/..', 'https://example.com/a/b', 'https://github.com/a/b/issues', 'https://name:secret@github.com/a/b', 'https://github.com/a/b?token=x', 'https://github.com/a/b#x', 'http://github.com/a/b', 'https://github.com:4430/a/b']) expect(publicRepositoryName(input)).toBeNull();
    expect(PUBLIC_SETTINGS_ACCOUNT).not.toMatch(/^[a-z\d-]+$/i);
  });
  it('restores only public metadata with canonical URLs', () => {
    const repo = { id: 1, full_name: 'sample/project', private: false, html_url: 'https://example.com', description: 'Public' };
    expect(publicRepositoryRecord(repo)).toMatchObject({ html_url: 'https://github.com/sample/project', owner: { login: 'sample' } });
    for (const value of [{ ...repo, private: true }, { ...repo, private: undefined }, { ...repo, id: -1 }, { ...repo, full_name: '../private' }, null]) expect(publicRepositoryRecord(value)).toBeNull();
  });
});
describe('anonymous GitHub transport', () => {
  it('omits Authorization and skips GraphQL-only optional data', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, full_name: 'sample/project', private: false })));
    vi.stubGlobal('fetch', fetcher);
    const client = new GitHub();
    expect(client.authenticated).toBe(false);
    await expect(client.publicRepository('https://github.com/sample/project')).resolves.toMatchObject({ full_name: 'sample/project', private: false });
    expect(fetcher.mock.calls[0]![0].pathname).toBe('/repos/sample/project');
    expect(new Headers(fetcher.mock.calls[0]![1].headers).has('Authorization')).toBe(false);
    const issue = { number: 1 } as Issue;
    expect(await client.issueRelations('sample/project', issue)).toBeNull();
    expect(await client.closingCommit('sample/project', issue)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps authenticated requests authenticated and rejects private repositories in the public picker', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, full_name: 'sample/private', private: true })));
    vi.stubGlobal('fetch', fetcher);
    await expect(new GitHub('fictional-test-token').publicRepository('sample/private')).rejects.toThrow();
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get('Authorization')).toBe('Bearer fictional-test-token');
  });
});

it('uses at most two shared history pages for public timers and closed estimates', async () => {
  const now = Date.now(), iso = (at: number) => new Date(at).toISOString();
  const repository = { id: 1, full_name: 'sample/project', name: 'project', private: false } as Repo;
  const active = { id: 1, number: 1, state: 'open', title: 'Active', labels: [{ name: 'in-progress', color: '' }], updated_at: iso(now), closed_at: null };
  const closed = { ...active, id: 2, number: 2, state: 'closed', labels: [], closed_at: iso(now - 60000) };
  const paths: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    paths.push(url.pathname + url.search);
    const data = url.pathname.endsWith('/labels') ? [] : url.pathname.endsWith('/events')
      ? url.searchParams.has('page') ? [] : [
        { id: 1, issue: { id: 1 }, event: 'labeled', label: { name: 'in-progress' }, created_at: iso(now - 1800000) },
        { id: 2, issue: { id: 2 }, event: 'labeled', label: { name: 'in-progress' }, created_at: iso(now - 900000) },
        { id: 3, issue: { id: 2 }, event: 'closed', created_at: closed.closed_at },
      ] : url.searchParams.get('state') === 'open' ? [active] : [closed];
    return new Response(JSON.stringify(data), { headers: url.pathname.endsWith('/events') ? { Link: '<https://api.github.com/repos/sample/project/issues/events?per_page=100&page=2>; rel="next"' } : {} });
  }));
  const lane = await new GitHub().lane(repository, {});
  expect(paths.filter(path => path.includes('/events'))).toHaveLength(2);
  expect(paths.some(path => /issues\/\d+\/events/.test(path))).toBe(false);
  expect(lane.issues.find(issue => issue.id === 1)?.startedAt).toBe(iso(now - 1800000));
  expect(lane.issues.find(issue => issue.id === 2)?.workStartedAt).toBe(iso(now - 900000));
});
