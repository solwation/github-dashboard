import { describe, expect, it } from "vitest";
import { StatisticsCollector, StatisticsCancelledError, statisticsLimits, type StatisticsClient } from "../src/lib/statistics-client";
import { formatStatisticsBound, summarizeStatistics, type StatisticsCommit } from "../src/lib/statistics";
import { parseStatisticsCache } from "../src/lib/statistics-cache";
const now = Date.parse("2026-10-16T15:00:00Z");
const issue = { id: 1, number: 1, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-13T00:00:00Z", labels: [{ name: "bug" }], user: { login: "alice" } };
const commit: StatisticsCommit = { sha: "first", parents: [{ sha: "parent" }], author: { login: "alice" }, commit: { author: { name: "Alice", date: "2026-10-12T01:00:00Z" }, committer: { date: "2026-10-12T02:00:00Z" } } };
const denied = () => Object.assign(new Error("fixture denied"), { status: 403, permissionDenied: true, rateLimited: false });
type Reply = { data: unknown; next: string | null };
function mockClient(handler: (url: URL) => Promise<Reply> | Reply) {
  const calls: URL[] = [];
  const client: StatisticsClient = { async request<T>(path: string) { const url = new URL(path, "https://api.github.com"); calls.push(url); return await handler(url) as { data: T; next: string | null }; } };
  return { calls, client };
}
function baseline(url: URL): Reply {
  if (url.pathname.endsWith("/issues/events")) return { data: [{ id: 1, event: "closed", created_at: "2026-10-13T00:00:00Z", issue, actor: { login: "alice" } }], next: null };
  if (url.pathname.endsWith("/issues")) return { data: [issue, { ...issue, id: 2, pull_request: {} }], next: null };
  if (url.pathname.endsWith("/commits")) {
    const since = url.searchParams.get("since");
    const data = [commit, { ...commit, sha: "merge", parents: [{ sha: "first" }, { sha: "other" }] }];
    return { data: since ? data.filter(item => (item.commit.committer?.date ?? item.commit.author?.date ?? "") >= since) : data, next: null };
  }
  if (url.pathname.includes("/commits/")) return { data: { stats: { additions: 10, deletions: 4 }, files: [{ filename: "first.ts" }] }, next: null };
  return { data: [], next: null };
}
describe("statistics transport and coverage", () => {
  it("uses bounded, paginated read requests, historical events and non-merge diffs", async () => {
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith("/issues/events") && !url.searchParams.has("page")) return { data: [{ id: 99, event: "closed", created_at: "2020-01-01T00:00:00Z", issue }], next: "/repos/sample/repo/issues/events?page=2" };
      if (url.pathname.includes("/commits/")) return { data: { stats: { additions: 10, deletions: 4 }, files: [{ filename: url.searchParams.get("page") === "2" ? "second.ts" : "first.ts" }] }, next: url.searchParams.get("page") === "2" ? null : "/repos/sample/repo/commits/first?page=2" };
      return baseline(url);
    });
    const result = await new StatisticsCollector(client).load("sample/repo", now);
    expect(result.issues!.data).toHaveLength(1);
    expect(result.events!.data).toHaveLength(1); // Do not assume API event ordering.
    expect(result.events!.complete).toBe(true);
    expect(result.commits!.data).toHaveLength(2);
    expect(result.changes!.data).toEqual([{ sha: "first", date: "2026-10-12T02:00:00Z", contributor: "alice", additions: 10, deletions: 4, files: 2, filesComplete: true }]);
    expect(calls.some(url => url.pathname.endsWith("/commits/merge"))).toBe(false);
    const request = calls.find(url => url.pathname.endsWith("/commits"))!;
    expect(request.searchParams.get("since")).toBe("2026-09-16T00:00:00Z");
    // Day-stable URL for free 304 revalidation; the window end is applied locally (#136).
    expect(request.searchParams.has("until")).toBe(false);
    expect(request.searchParams.has("sha")).toBe(false);
  });
  it("deduplicates overlapping pages and marks capped event history incomplete", async () => {
    const { calls, client } = mockClient(url => url.pathname.endsWith("/issues/events") ? { ...baseline(url), next: `/repos/sample/repo/issues/events?page=${Number(url.searchParams.get("page") || 1) + 1}` } : baseline(url));
    const data = await new StatisticsCollector(client).load("sample/repo", now);
    expect(calls.filter(url => url.pathname.endsWith("/issues/events"))).toHaveLength(statisticsLimits.events);
    expect(data.events!.data).toHaveLength(1);
    expect(data.events!.complete).toBe(false);
    expect(summarizeStatistics([data], { from: data.from, to: data.to, label: "", contributor: "" }).complete.closed).toBe(false);
  });
  it("collects all three days beyond the old 500-event and 60-diff cutoffs, including after cache restore", async () => {
    const at = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
    const events = Array.from({ length: 600 }, (_, id) => ({ id, event: "closed", created_at: at(12), issue }));
    events.push({ id: 600, event: "closed", created_at: at(36), issue }, { id: 601, event: "closed", created_at: at(60), issue });
    const commits = Array.from({ length: 63 }, (_, id) => ({ ...commit, sha: `period-${id}`, commit: { committer: { date: at(id < 61 ? 12 : id === 61 ? 36 : 60) } } }));
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith("/issues/events")) {
        const page = Number(url.searchParams.get("page") || 1);
        return { data: events.slice((page - 1) * 100, page * 100), next: page < 7 ? `/repos/sample/repo/issues/events?page=${page + 1}` : null };
      }
      if (url.pathname.endsWith("/commits")) return { data: commits, next: null };
      return baseline(url);
    });
    const collector = new StatisticsCollector(client);
    const data = await collector.load("sample/repo", now);
    expect(data.events!.complete).toBe(true);
    expect(data.changes!.complete).toBe(true);
    const window = (hours: number) => ({ from: formatStatisticsBound(now - hours * 3_600_000), to: formatStatisticsBound(now), resolution: "1h" as const, label: "", contributor: "" });
    const full = summarizeStatistics([data], window(72));
    expect(full.totals.closed).toBe(602);
    expect(full.totals.additions).toBe(630);
    // Each older 24-hour slice contributes even though its records occur after
    // the old transport/detail cutoffs. An actual zero stays a measured zero.
    expect([0, 24, 48].map(start => full.days.slice(start, start + 24).reduce((sum, day) => sum + day.values.closed!, 0))).toEqual([1, 1, 600]);
    expect([0, 24, 48].map(start => full.days.slice(start, start + 24).reduce((sum, day) => sum + day.values.additions!, 0))).toEqual([10, 10, 610]);
    expect(summarizeStatistics([data], window(24)).totals.closed).toBe(600);
    const saved = parseStatisticsCache({ version: 1, repositories: [data] }, now);
    expect(saved[0]!.events!.data).toHaveLength(602);
    const restored = new StatisticsCollector(client); restored.restore(saved);
    expect(summarizeStatistics([restored.cached("sample/repo", now)!], window(72)).totals).toEqual(full.totals);
    calls.length = 0;
    const refreshed = await restored.load("sample/repo", now + 1000, true);
    expect(summarizeStatistics([refreshed], window(72)).totals).toEqual(full.totals);
    expect(calls.filter(url => url.pathname.includes("/commits/"))).toHaveLength(0);
  });
  it("retains label transitions needed by board history while dropping unrelated events", async () => {
    const { client } = mockClient(url => url.pathname.endsWith("/issues/events")
      ? { data: ["closed", "reopened", "labeled", "unlabeled", "assigned", "renamed"].map((event, id) => ({ id, event, created_at: "2026-10-13T00:00:00Z", issue, label: { name: "in-progress" } })), next: null }
      : baseline(url));
    const data = await new StatisticsCollector(client).load("sample/repo", now);
    expect(data.events!.data.map(event => event.event)).toEqual(["closed", "reopened", "labeled", "unlabeled"]);
  });
  it("silently hides only genuinely inaccessible sources and preserves true zeros", async () => {
    const { client } = mockClient(url => {
      if (url.pathname.includes("/commits") || url.pathname.endsWith("/pulls")) throw denied();
      return baseline(url);
    });
    const data = await new StatisticsCollector(client).load("sample/repo", now);
    expect(data.commits).toBeNull(); expect(data.changes).toBeNull(); expect(data.pulls).toBeNull();
    expect(data.temporary).toEqual([]);
    expect(summarizeStatistics([data], { from: data.from, to: data.to, label: "", contributor: "" }).totals).toEqual({ created: 1, closed: 1, reopened: 0, netIssues: 0 });
  });
  it("retains previously collected sources for network failures and rate limits", async () => {
    let failure: Error | null = null;
    const { calls, client } = mockClient(url => { if (failure) throw failure; return baseline(url); });
    const collector = new StatisticsCollector(client);
    const first = await collector.load("sample/repo", now);
    const count = calls.length;
    expect(await collector.load("sample/repo", now + 1000)).toBe(first);
    expect(calls).toHaveLength(count);
    failure = Object.assign(new Error("limited"), { status: 403, permissionDenied: false, rateLimited: true });
    const limited = await collector.load("sample/repo", now + 2000, true);
    expect(limited.issues).toBe(first.issues); expect(limited.events).toBe(first.events);
    expect(limited.commits).toBe(first.commits); expect(limited.changes!.data).toEqual(first.changes!.data);
    expect(limited.temporary).toEqual(expect.arrayContaining(["issues", "events", "commits", "pulls"]));
    failure = new Error("network offline");
    const offline = await collector.load("sample/repo", now + 3000, true);
    expect(offline.issues!.data).toEqual(first.issues!.data);
  });
  it("does not mistake an unclassified 403, 409, or initial failure for missing rights or zero", async () => {
    for (const status of [403, 409, 429, 500]) {
      const { client } = mockClient(() => { throw Object.assign(new Error("temporary"), { status }); });
      const data = await new StatisticsCollector(client).load("sample/repo", now);
      expect(data.commits).toBeNull();
      expect(data.temporary).toContain("commits");
      expect(data.temporary).toContain("issues");
    }
  });
  it("treats only a positively identified empty Git repository as zero commits", async () => {
    const { client } = mockClient(url => {
      if (url.pathname.endsWith("/commits")) throw Object.assign(new Error("Git Repository is empty."), { status: 409, emptyRepository: true });
      return baseline(url);
    });
    const data = await new StatisticsCollector(client).load("sample/repo", now);
    expect(data.commits!.data).toEqual([]); expect(data.commits!.complete).toBe(true);
    expect(data.changes!.data).toEqual([]); expect(data.temporary).toEqual([]);
  });
  it("hides newly denied cached sources instead of showing the old values", async () => {
    let revoked = false;
    const { client } = mockClient(url => { if (revoked && url.pathname.endsWith("/commits")) throw denied(); return baseline(url); });
    const collector = new StatisticsCollector(client);
    expect((await collector.load("sample/repo", now)).commits).not.toBeNull();
    revoked = true;
    const result = await collector.load("sample/repo", now + 1000, true);
    expect(result.commits).toBeNull(); expect(result.changes).toBeNull(); expect(result.temporary).toEqual([]);
  });
  it("limits commit-detail work, reuses immutable SHA details and marks file truncation", async () => {
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith("/commits")) return { data: Array.from({ length: 605 }, (_, index) => ({ ...commit, sha: `sha${index}` })), next: null };
      if (url.pathname.includes("/commits/")) return { ...baseline(url), next: `${url.pathname}?page=${Number(url.searchParams.get("page") || 1) + 1}` };
      return baseline(url);
    });
    const collector = new StatisticsCollector(client);
    const first = await collector.load("sample/repo", now);
    expect(first.changes!.data).toHaveLength(statisticsLimits.changes); expect(first.changes!.complete).toBe(false);
    expect(first.changes!.data.every(change => !change.filesComplete)).toBe(true);
    expect(calls.filter(url => url.pathname.includes("/commits/"))).toHaveLength(statisticsLimits.changes * 3);
    await collector.load("sample/repo", now + 1000, true);
    expect(calls.filter(url => url.pathname.includes("/commits/"))).toHaveLength(statisticsLimits.changes * 3);
  });
  it("enforces the concurrency bound across repositories and coalesces simultaneous loads", async () => {
    let active = 0, maximum = 0;
    const { client } = mockClient(async url => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--; return baseline(url);
    });
    const collector = new StatisticsCollector(client);
    const [first, again] = await Promise.all([collector.load("sample/one", now), collector.load("sample/one", now), ...Array.from({ length: 7 }, (_, index) => collector.load(`sample/repository${index}`, now))]);
    expect(first).toBe(again);
    expect(maximum).toBeLessThanOrEqual(3);
  });
  it("does not follow up with authenticated requests after the session is disposed", async () => {
    const finish: (() => void)[] = [];
    const { calls, client } = mockClient(async () => {
      await new Promise<void>(resolve => { finish.push(resolve); });
      return { data: [], next: "/repos/sample/repo/issues?page=2" };
    });
    const collector = new StatisticsCollector(client);
    const work = collector.load("sample/repo", now);
    collector.dispose();
    expect(calls.length).toBeLessThanOrEqual(3);
    for (const resolve of finish) resolve();
    await expect(work).rejects.toBeInstanceOf(StatisticsCancelledError);
    expect(collector.export()).toEqual([]);
    expect(collector.cached("sample/repo", now)).toBeUndefined();
    await expect(collector.load("sample/repo", now)).rejects.toThrow("Statistics session ended");
    expect(calls.length).toBeLessThanOrEqual(3);
    await expect(new StatisticsCollector(client).load("../outside/repo", now)).rejects.toThrow("Invalid repository");
  });
});

describe('persistent statistics history reuse', () => {
  it('restores immediately, refetches the previous partial day and reuses immutable older commit details after two days', async () => {
    let shifted = false;
    const historical = { ...commit, sha: 'historical' };
    const overlap = { ...commit, sha: 'overlap', parents: [{ sha: 'historical' }], commit: { committer: { date: '2026-10-16T01:00:00Z' } } };
    const fresh = { ...commit, sha: 'new', parents: [{ sha: 'overlap' }], commit: { committer: { date: '2026-10-18T01:00:00Z' } } };
    const { calls, client } = mockClient(url => url.pathname.endsWith('/commits')
      ? { data: shifted ? [overlap, fresh] : [historical, overlap], next: null } : baseline(url));
    const first = new StatisticsCollector(client);
    await first.load('sample/repo', now);
    const restored = new StatisticsCollector(client);
    restored.restore(first.export());
    expect(restored.cached('sample/repo', now + 2 * 86400000)?.commits?.complete).toBe(false);
    calls.length = 0; shifted = true;
    const result = await restored.load('sample/repo', now + 2 * 86400000);
    expect(calls.find(url => url.pathname.endsWith('/commits'))!.searchParams.get('since')).toBe('2026-10-16T00:00:00Z');
    expect(result.commits!.data.map(commit => commit.sha).sort()).toEqual(['historical', 'new', 'overlap']);
    expect(result.commits!.complete).toBe(true);
    expect(calls.filter(url => url.pathname.includes('/commits/')).map(url => url.pathname)).toEqual(['/repos/sample/repo/commits/new']);
    expect(calls.find(url => url.pathname.endsWith('/issues'))!.searchParams.get('since')).toBe('2026-09-18T00:00:00Z');
  });
  it('full revalidation removes rewritten branch history, and partial cached history never enables incremental coverage', async () => {
    let current: StatisticsCommit[] = [commit];
    const { calls, client } = mockClient(url => url.pathname.endsWith('/commits') ? { data: current, next: null } : baseline(url));
    const collector = new StatisticsCollector(client);
    await collector.load('sample/repo', now);
    current = [];
    const forced = await collector.load('sample/repo', now + 86400000, true);
    expect(forced.commits!.data).toEqual([]);
    expect(forced.changes!.data).toEqual([]);
    expect(calls.filter(url => url.pathname.endsWith('/commits')).at(-1)!.searchParams.get('since')).toBe('2026-09-17T00:00:00Z');
    const partial = { ...forced, commits: { ...forced.commits!, complete: false } };
    const next = new StatisticsCollector(client); next.restore([partial]); calls.length = 0;
    await next.load('sample/repo', now + 2 * 86400000);
    expect(calls.find(url => url.pathname.endsWith('/commits'))!.searchParams.get('since')).toBe('2026-09-18T00:00:00Z');
  });
  it('does not promote missing interval data or denied sources to complete after reload', async () => {
    let failure = false;
    const { client } = mockClient(url => { if (failure) throw new Error('offline'); return baseline(url); });
    const first = new StatisticsCollector(client); await first.load('sample/repo', now);
    const restored = new StatisticsCollector(client); restored.restore(first.export()); failure = true;
    const offline = await restored.load('sample/repo', now + 2 * 86400000);
    expect(offline.issues!.complete).toBe(false); expect(offline.events!.complete).toBe(false); expect(offline.commits!.complete).toBe(false);
    expect(offline.temporary).toContain('commits');
    const revoked = new StatisticsCollector(mockClient(() => { throw denied(); }).client); revoked.restore(first.export());
    const deniedData = await revoked.load('sample/repo', now + 86400000);
    expect(deniedData.commits).toBeNull(); expect(deniedData.issues).toBeNull(); expect(deniedData.changes).toBeNull();
  });
  it('revalidates hydrated same-day cache and forces full history after the weekly verification deadline', async () => {
    const { calls, client } = mockClient(baseline);
    const first = new StatisticsCollector(client); await first.load('sample/repo', now);
    const restored = new StatisticsCollector(client); restored.restore(first.export()); calls.length = 0;
    await restored.load('sample/repo', now + 1000);
    expect(calls.length).toBeGreaterThan(0);
    calls.length = 0;
    await restored.load('sample/repo', now + 7 * 86400000);
    expect(calls.find(url => url.pathname.endsWith('/commits'))!.searchParams.get('since')).toBe('2026-09-23T00:00:00Z');
  });
  it('discards history reuse and fetches the full window when a merge commit introduces an older-dated commit (#321)', async () => {
    const c0: StatisticsCommit = { ...commit, sha: 'c0', parents: [], commit: { committer: { date: '2026-09-01T00:00:00Z' } } };
    const c1: StatisticsCommit = { ...commit, sha: 'c1', parents: [{ sha: 'c0' }], commit: { committer: { date: '2026-10-15T12:00:00Z' } } };
    const pr1: StatisticsCommit = { ...commit, sha: 'pr1', parents: [{ sha: 'c1' }], commit: { committer: { date: '2026-10-14T10:00:00Z' } } };
    const merge: StatisticsCommit = { ...commit, sha: 'merge1', parents: [{ sha: 'c1' }, { sha: 'pr1' }], commit: { committer: { date: '2026-10-17T10:00:00Z' } } };

    let allCommits: StatisticsCommit[] = [c1];
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith('/commits')) {
        const sinceParam = url.searchParams.get('since');
        const data = sinceParam ? allCommits.filter(c => (c.commit.committer?.date ?? '') >= sinceParam) : allCommits;
        return { data, next: null };
      }
      return baseline(url);
    });

    const collector = new StatisticsCollector(client);
    await collector.load('sample/repo', now); // 2026-10-16: fetches c1

    // Merge lands: default branch now contains c1, pr1, merge1.
    allCommits = [merge, pr1, c1];
    calls.length = 0;

    const later = now + 86400000; // 2026-10-17
    const result = await collector.load('sample/repo', later);

    const commitCalls = calls.filter(url => url.pathname.endsWith('/commits'));
    // Incremental fetch returned only [merge1] (since pr1 is from 2026-10-14 < 2026-10-16).
    // Because pr1 is missing from historical and fetched commits, reuse was invalidated and full window was fetched.
    expect(commitCalls).toHaveLength(2);
    expect(commitCalls[0]!.searchParams.get('since')).toBe('2026-10-16T00:00:00Z');
    expect(commitCalls[1]!.searchParams.get('since')).toBe('2026-09-17T00:00:00Z');
    expect(result.commits!.data.map(c => c.sha).sort()).toEqual(['c1', 'merge1', 'pr1']);
    expect(result.commits!.historyVerifiedAt).toBe(later);
  });
  it('discards history reuse and fetches the full window when a fast-forward introduces an older-dated commit (#321)', async () => {
    const c1: StatisticsCommit = { ...commit, sha: 'c1', parents: [], commit: { committer: { date: '2026-10-15T12:00:00Z' } } };
    const delayed: StatisticsCommit = { ...commit, sha: 'delayed', parents: [{ sha: 'c1' }], commit: { committer: { date: '2026-10-14T12:00:00Z' } } };
    const c2: StatisticsCommit = { ...commit, sha: 'c2', parents: [{ sha: 'delayed' }], commit: { committer: { date: '2026-10-16T20:00:00Z' } } };

    let allCommits: StatisticsCommit[] = [c1];
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith('/commits')) {
        const sinceParam = url.searchParams.get('since');
        const data = sinceParam ? allCommits.filter(c => (c.commit.committer?.date ?? '') >= sinceParam) : allCommits;
        return { data, next: null };
      }
      return baseline(url);
    });

    const collector = new StatisticsCollector(client);
    await collector.load('sample/repo', now);

    allCommits = [c2, delayed, c1];
    calls.length = 0;

    const later = now + 86400000;
    const result = await collector.load('sample/repo', later);

    const commitCalls = calls.filter(url => url.pathname.endsWith('/commits'));
    expect(commitCalls).toHaveLength(2);
    expect(commitCalls[0]!.searchParams.get('since')).toBe('2026-10-16T00:00:00Z');
    expect(commitCalls[1]!.searchParams.get('since')).toBe('2026-09-17T00:00:00Z');
    expect(result.commits!.data.map(c => c.sha).sort()).toEqual(['c1', 'c2', 'delayed']);
  });
  it('preserves history reuse on linear incremental updates without refetching the full window (#321)', async () => {
    const c1: StatisticsCommit = { ...commit, sha: 'c1', parents: [], commit: { committer: { date: '2026-10-15T12:00:00Z' } } };
    const c2: StatisticsCommit = { ...commit, sha: 'c2', parents: [{ sha: 'c1' }], commit: { committer: { date: '2026-10-17T10:00:00Z' } } };

    let allCommits: StatisticsCommit[] = [c1];
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith('/commits')) {
        const sinceParam = url.searchParams.get('since');
        const data = sinceParam ? allCommits.filter(c => (c.commit.committer?.date ?? '') >= sinceParam) : allCommits;
        return { data, next: null };
      }
      return baseline(url);
    });

    const collector = new StatisticsCollector(client);
    const first = await collector.load('sample/repo', now);
    const verified = first.commits!.historyVerifiedAt;

    allCommits = [c2, c1];
    calls.length = 0;

    const later = now + 86400000;
    const result = await collector.load('sample/repo', later);

    const commitCalls = calls.filter(url => url.pathname.endsWith('/commits'));
    expect(commitCalls).toHaveLength(1);
    expect(commitCalls[0]!.searchParams.get('since')).toBe('2026-10-16T00:00:00Z');
    expect(result.commits!.data.map(c => c.sha).sort()).toEqual(['c1', 'c2']);
    expect(result.commits!.historyVerifiedAt).toBe(verified);
  });
  it('preserves history reuse when commit parent is older than the statistics window (#321)', async () => {
    // c_old is from 2026-09-10, which was in history when window started earlier
    const c_old: StatisticsCommit = { ...commit, sha: 'c_old', parents: [], commit: { committer: { date: '2026-09-10T12:00:00Z' } } };
    const c1: StatisticsCommit = { ...commit, sha: 'c1', parents: [{ sha: 'c_old' }], commit: { committer: { date: '2026-10-15T12:00:00Z' } } };
    const c2: StatisticsCommit = { ...commit, sha: 'c2', parents: [{ sha: 'c_old' }], commit: { committer: { date: '2026-10-17T10:00:00Z' } } };

    let allCommits: StatisticsCommit[] = [c1, c_old];
    const { calls, client } = mockClient(url => {
      if (url.pathname.endsWith('/commits')) {
        const sinceParam = url.searchParams.get('since');
        const data = sinceParam ? allCommits.filter(c => (c.commit.committer?.date ?? '') >= sinceParam) : allCommits;
        return { data, next: null };
      }
      return baseline(url);
    });

    const collector = new StatisticsCollector(client);
    // Initial collection with window from 2026-09-10
    const first = await collector.load('sample/repo', Date.parse('2026-10-10T12:00:00Z'));
    // Ensure c_old is retained in the cache
    expect(first.commits!.data.map(c => c.sha)).toContain('c_old');

    allCommits = [c2, c1, c_old];
    calls.length = 0;

    const later = now + 86400000; // window.from is now 2026-09-17, c_old (2026-09-10) is older than window
    const result = await collector.load('sample/repo', later);

    const commitCalls = calls.filter(url => url.pathname.endsWith('/commits'));
    expect(commitCalls).toHaveLength(1);
    expect(result.commits!.data.map(c => c.sha)).toContain('c2');
  });
});
