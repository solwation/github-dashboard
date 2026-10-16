import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHub, GitHubApiError } from '../src/lib/github';
import { missingPermissionCount, permissionForPath } from '../src/lib/permissions';
import type { Repo } from '../src/lib/model';
const repo = (name: string, isPrivate = true) => ({ full_name: name, private: isPrivate }) as Repo;
function response(status = 200, body: unknown = [], headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
afterEach(() => vi.unstubAllGlobals());
describe('read-only permission checks', () => {
  it('confirms private effective access, reuses observations and distinguishes public readability', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetch);
    const api = new GitHub('test-secret');
    const report = await api.checkPermissions([repo('owner/private'), repo('owner/public', false)]);
    expect(report).toHaveLength(4);
    for (const entry of report) {
      expect(entry.repositories[0]).toMatchObject({ status: 'granted', reason: 'private-access' });
      expect(entry.repositories[1]).toMatchObject({ status: 'unknown', reason: 'public-access' });
    }
    await api.checkPermissions([repo('owner/private')]);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(fetch.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('test-secret');
  });
  it('counts a missing permission once across repositories and preserves permission-denial status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: URL) => Promise.resolve(url.pathname.endsWith('/commits')
      ? response(403, { message: 'Resource not accessible by personal access token' }) : response())));
    const api = new GitHub('secret');
    const report = await api.checkPermissions([repo('owner/a'), repo('owner/b')]);
    expect(missingPermissionCount(report)).toBe(1);
    expect(report.find(entry => entry.permission === 'contents')!.repositories.every(entry => entry.status === 'missing')).toBe(true);
    await expect(api.request('/repos/owner/a/commits')).rejects.toMatchObject({ status: 403, permissionDenied: true, rateLimited: false });
  });
  it.each([
    [404, {}, {}], [401, {}, {}], [403, { message: 'Forbidden' }, {}],
    [403, { message: 'Resource not accessible by integration' }, { 'x-ratelimit-remaining': '0' }],
    [429, { message: 'Resource not accessible by integration' }, {}],
  ])('keeps ambiguous or transient HTTP %s neutral', async (status, body, headers) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(response(status, body, headers))));
    const report = await new GitHub('secret').checkPermissions([repo('owner/a')]);
    expect(missingPermissionCount(report)).toBe(0);
    expect(report.every(entry => entry.repositories[0]?.status === 'unknown')).toBe(true);
  });
  it('makes forced rechecks neutral after network failure and never requests malformed repo paths', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response()));
    vi.stubGlobal('fetch', fetch);
    const api = new GitHub('secret');
    await api.checkPermissions([repo('owner/a')]);
    fetch.mockRejectedValue(new Error('offline'));
    const report = await api.checkPermissions([repo('owner/a'), repo('owner/a/../../user')], { force: true });
    expect(report.every(entry => entry.repositories.length === 1 && entry.repositories[0]?.status === 'unknown')).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(8);
  });
  it('recognizes only relevant permission endpoints', () => {
    expect(permissionForPath('/repos/owner/repo/commits')).toEqual({ repo: 'owner/repo', permission: 'contents' });
    expect(permissionForPath('/repos/owner/repo/issues/123')).toBeNull();
    expect(permissionForPath('/user/repos')).toBeNull();
    expect(new GitHubApiError('safe', 403).status).toBe(403);
  });
});
