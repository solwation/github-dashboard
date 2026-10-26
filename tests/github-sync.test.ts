import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import type { Issue, Lane, Repo } from "../src/lib/model";
import { createIssueSync, RepositoryBackoff } from "../src/lib/sync";
const repo: Repo = {
  id: 1,
  name: "test",
  full_name: "sample/test",
  description: null,
  private: true,
  html_url: "https://github.com/sample/test",
  owner: { login: "sample" },
};
const make = (
  id: number,
  state: string,
  labels: string[] = [],
  closed_at: string | null = null,
): Issue => ({
  id,
  number: id,
  title: "Fixture",
  state,
  labels: labels.map((name) => ({ name, color: "aaa" })),
  created_at: "2026-01-01",
  updated_at: "2026-10-15T12:00:00Z",
  closed_at,
  html_url: repo.html_url + "/issues/" + id,
  assignees: [],
});
afterEach(() => vi.unstubAllGlobals());
describe("conditional and incremental synchronization", () => {
  it("reuses a private in-memory GET response on 304, including pagination, but never caches POST", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("[1]", {
          headers: {
            etag: '"v1"',
            link: '<https://api.github.com/next>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValue(new Response("{}", { headers: { etag: '"post"' } }));
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("test");
    const first = await api.request("/resource"),
      second = await api.request("/resource");
    expect(second).toEqual(first);
    expect(fetch.mock.calls[1]![1].headers["If-None-Match"]).toBe('"v1"');
    expect(fetch.mock.calls[0]![1].cache).toBe("no-store");
    await api.request("/graphql", { method: "POST", body: "{}" });
    expect(fetch.mock.calls[2]![1].headers["If-None-Match"]).toBeUndefined();
  });
  it("merges changed issues, discovers new work, keeps unchanged backlog and expires old closed issues", async () => {
    const previous: Lane = {
      repo,
      labels: [],
      issues: [
        make(1, "open"),
        make(2, "open", ["in-progress"]),
        make(3, "closed", [], "2020-01-01T00:00:00Z"),
      ],
    };
    const closure = new Date().toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: URL) =>
          new Response(
            JSON.stringify(
              url.pathname.endsWith("/labels")
                ? []
                : [make(2, "closed", [], closure), make(4, "open")],
            ),
          ),
      ),
    );
    const result = await new GitHub("test").syncLane(
      previous,
      {},
      Date.now() - 10000,
    );
    expect(result.issues.map((issue) => issue.id).sort()).toEqual([1, 2, 4]);
    expect(result.issues.find((issue) => issue.id === 2)?.state).toBe("closed");
    expect(previous.issues[1]?.state).toBe("open");
  });
  it("revalidates a stable incremental list with ETags and fetches labels only when due or unseen (#123)", async () => {
    const urls: string[] = [];
    let body: Issue[] = [make(2, "open", ["in-progress"])];
    let etag = '"v1"';
    const fetch = vi.fn(async (url: URL, init: RequestInit) => {
      urls.push(url.pathname + url.search);
      const headers = init.headers as Record<string, string>;
      if (url.pathname.endsWith("/labels")) return new Response(JSON.stringify([{ name: "in-progress", color: "aaa" }, { name: "bug", color: "bbb" }]));
      if (url.pathname.endsWith("/events")) return new Response("[]");
      if (headers["If-None-Match"] === etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(body), { headers: { etag } });
    });
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("test");
    const anchor = Date.UTC(2026, 9, 17, 10, 0, 30);
    let lane: Lane = { repo, labels: [{ name: "in-progress", color: "aaa" }], issues: [make(1, "open"), make(2, "open", ["in-progress"])] };
    lane = await api.syncLane(lane, {}, anchor, { labels: false });
    lane = await api.syncLane(lane, {}, anchor, { labels: false });
    const lists = urls.filter(url => url.includes("since="));
    expect(lists).toHaveLength(2);
    expect(new Set(lists).size).toBe(1);
    expect(lists[0]).toContain(`since=${encodeURIComponent("2026-10-17T10:00:00.000Z").replace(/%3A/g, ":")}`);
    const listCalls = fetch.mock.calls.filter(([url]) => url.searchParams.has("since"));
    expect((listCalls[1]![1].headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');
    expect(urls.some(url => url.endsWith("/labels?per_page=100"))).toBe(false);
    expect(lane.issues.map(issue => issue.id).sort()).toEqual([1, 2]);
    // A label the lane has not seen loads label definitions even on the active tick.
    body = [make(1, "open", ["bug"])];
    etag = '"v2"';
    lane = await api.syncLane(lane, {}, anchor, { labels: false });
    expect(urls.filter(url => url.endsWith("/labels?per_page=100"))).toHaveLength(1);
    expect(lane.labels.map(label => label.name)).toEqual(["in-progress", "bug"]);
    expect(lane.issues.find(issue => issue.id === 1)?.labels.map(label => label.name)).toEqual(["bug"]);
    // Reconciliation revalidates labels only after the TTL.
    await api.syncLane(lane, {}, anchor);
    expect(urls.filter(url => url.endsWith("/labels?per_page=100"))).toHaveLength(1);
  });
  it("records server retry delays without discarding API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("{}", {
            status: 429,
            headers: { "retry-after": "120" },
          }),
        ),
    );
    const api = new GitHub("test");
    await expect(api.request("/test")).rejects.toThrow();
    expect(api.retryAfterMs()).toBeGreaterThan(119000);
  });
  it("keeps active issue sync every 15s for healthy repos while a failing 404 repo backs off without reload", async () => {
    vi.useFakeTimers();
    const healthyRepo: Repo = {
      id: 1,
      name: "healthy",
      full_name: "sample/healthy",
      description: null,
      private: true,
      html_url: "https://github.com/sample/healthy",
      owner: { login: "sample" },
    };
    const failingRepo: Repo = {
      id: 2,
      name: "failing",
      full_name: "sample/failing",
      description: null,
      private: true,
      html_url: "https://github.com/sample/failing",
      owner: { login: "sample" },
    };
    const repos = [healthyRepo, failingRepo];
    let healthyLaneReloadCount = 0;
    let healthySyncCount = 0;
    let failingLaneAttempts = 0;
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
      const pathname = url.pathname;
      if (pathname.includes("sample/failing")) {
        return new Response("Not Found", { status: 404, statusText: "Not Found" });
      }
      if (pathname.endsWith("/labels")) {
        return new Response("[]");
      }
      if (pathname.endsWith("/events")) {
        return new Response("[]");
      }
      const headers = (init?.headers as Record<string, string>) || {};
      if (headers["If-None-Match"] === '"etag-v1"') {
        return new Response(null, { status: 304 });
      }
      return new Response(JSON.stringify([make(1, "open", ["in-progress"])]), {
        headers: { etag: '"etag-v1"' },
      });
    });
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("test");
    const backoff = new RepositoryBackoff();
    let lanes: Lane[] = [
      { repo: healthyRepo, labels: [], issues: [] },
      { repo: failingRepo, labels: [], issues: [] },
    ];
    const lastSynced = new Map<string, number>();
    const lastFullSynced = new Map<string, number>();

    async function refresh(incremental = false, activeOnly = false) {
      if ((api.retryAfterMs() || 0) > 0) {
        if (incremental) throw new Error("Rate limited");
        return;
      }
      const nowMs = Date.now();
      const targets = repos.filter(repo => {
        const hasActive = lanes.some(lane => lane.repo.full_name === repo.full_name && lane.issues.some(i => i.labels.some(l => l.name === "in-progress")));
        return backoff.shouldSync(repo.full_name, {
          hasActive,
          reconcile: !activeOnly,
        }, nowMs);
      });
      for (const repo of targets) {
        if ((api.retryAfterMs() || 0) > 0) break;
        try {
          const previous = lanes.find(lane => lane.repo.full_name === repo.full_name);
          const since = lastSynced.get(repo.full_name);
          const full = !incremental || !previous || previous.loading || !!previous.error || !since;
          if (repo.full_name === "sample/healthy") {
            if (full) healthyLaneReloadCount++;
            else healthySyncCount++;
          } else if (repo.full_name === "sample/failing") {
            failingLaneAttempts++;
          }
          const loaded = full
            ? await api.lane(repo, {}, previous && !previous.loading ? previous : undefined)
            : await api.syncLane(previous!, {}, lastFullSynced.get(repo.full_name) || 0, { labels: !activeOnly });
          backoff.recordSuccess(repo.full_name);
          lastSynced.set(repo.full_name, Date.now());
          if (full) lastFullSynced.set(repo.full_name, Date.now());
          lanes = lanes.map(l => l.repo.full_name === repo.full_name ? loaded : l);
        } catch (cause) {
          if ((api.retryAfterMs() || 0) === 0) {
            backoff.recordFailure(repo.full_name);
          }
          const old = lanes.find(l => l.repo.full_name === repo.full_name);
          const failed = { ...old!, loading: false, error: (cause as Error).message };
          lanes = lanes.map(l => l.repo.full_name === repo.full_name ? failed : l);
        }
      }
      if (incremental && (api.retryAfterMs() || 0) > 0) throw new Error("Rate limited");
    }

    const sync = createIssueSync({
      canSync: () => true,
      hasActiveIssues: () => lanes.some(l => l.issues.some(i => i.labels.some(lbl => lbl.name === "in-progress"))) || repos.some(r => backoff.isDue(r.full_name)),
      refreshActive: () => refresh(true, true),
      reconcile: () => refresh(true, false),
      retryAfterMs: () => api.retryAfterMs(),
    });
    sync.start();

    // Initial load: reconcile runs at t = 0
    await vi.advanceTimersByTimeAsync(0);
    expect(healthyLaneReloadCount).toBe(1);
    expect(failingLaneAttempts).toBe(1);
    expect(lanes.find(l => l.repo.full_name === "sample/failing")?.error).toContain("404");
    expect(backoff.failureCount("sample/failing")).toBe(1);
    expect(backoff.isBackingOff("sample/failing")).toBe(true);

    // t = 15s: first active tick. Failing repo backoff (15s) has expired -> retried. Healthy repo uses syncLane.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(healthySyncCount).toBe(1);
    expect(healthyLaneReloadCount).toBe(1); // healthy repo was NOT reloaded!
    expect(failingLaneAttempts).toBe(2);
    expect(backoff.failureCount("sample/failing")).toBe(2);
    // Failing repo backed off for 30s
    expect(backoff.isBackingOff("sample/failing")).toBe(true);

    // t = 30s: second active tick. Failing repo is in 30s backoff -> SKIPPED! Healthy repo still updates!
    await vi.advanceTimersByTimeAsync(15_000);
    expect(healthySyncCount).toBe(2);
    expect(healthyLaneReloadCount).toBe(1); // healthy repo still not reloaded
    expect(failingLaneAttempts).toBe(2); // failing repo was NOT requested!
    expect(lanes.find(l => l.repo.full_name === "sample/failing")?.error).toContain("404");

    // t = 45s: third active tick. 30s backoff for failing repo has now expired -> retried!
    await vi.advanceTimersByTimeAsync(15_000);
    expect(healthySyncCount).toBe(3);
    expect(healthyLaneReloadCount).toBe(1); // still not reloaded
    expect(failingLaneAttempts).toBe(3); // retried!
    expect(backoff.failureCount("sample/failing")).toBe(3);

    sync.stop();
  });
  it("pauses all synchronization when a genuine rate limit occurs", async () => {
    vi.useFakeTimers();
    const repoA: Repo = { id: 1, name: "repoA", full_name: "sample/repoA", description: null, private: true, html_url: "", owner: { login: "sample" } };
    const repoB: Repo = { id: 2, name: "repoB", full_name: "sample/repoB", description: null, private: true, html_url: "", owner: { login: "sample" } };
    const repos = [repoA, repoB];
    let rateLimited = false;
    let requestCount = 0;
    const fetch = vi.fn(async (url: URL) => {
      requestCount++;
      if (rateLimited) {
        return new Response("Rate limited", { status: 429, headers: { "retry-after": "60" } });
      }
      if (url.pathname.endsWith("/labels") || url.pathname.endsWith("/events")) return new Response("[]");
      return new Response(JSON.stringify([make(1, "open", ["in-progress"])]), { headers: { etag: '"v1"' } });
    });
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("test");
    const backoff = new RepositoryBackoff();
    let lanes: Lane[] = [
      { repo: repoA, labels: [], issues: [] },
      { repo: repoB, labels: [], issues: [] },
    ];
    async function refresh(incremental = false, activeOnly = false) {
      if ((api.retryAfterMs() || 0) > 0) {
        if (incremental) throw new Error("Rate limited");
        return;
      }
      for (const repo of repos) {
        if ((api.retryAfterMs() || 0) > 0) break;
        try {
          const prev = lanes.find(l => l.repo.full_name === repo.full_name);
          const full = !incremental || !prev || !prev.issues.length;
          const loaded = full ? await api.lane(repo, {}) : await api.syncLane(prev!, {}, 0, { labels: !activeOnly });
          lanes = lanes.map(l => l.repo.full_name === repo.full_name ? loaded : l);
        } catch (err) {
          lanes = lanes.map(l => l.repo.full_name === repo.full_name ? { ...l, error: (err as Error).message } : l);
        }
      }
      if (incremental && (api.retryAfterMs() || 0) > 0) throw new Error("Rate limited");
    }
    const sync = createIssueSync({
      canSync: () => true,
      hasActiveIssues: () => lanes.some(l => l.issues.some(i => i.labels.some(lbl => lbl.name === "in-progress"))),
      refreshActive: () => refresh(true, true),
      reconcile: () => refresh(true, false),
      retryAfterMs: () => api.retryAfterMs(),
    });
    sync.start();

    // Initial load: 2 repos succeed
    await vi.advanceTimersByTimeAsync(0);
    const initialRequests = requestCount;
    expect(initialRequests).toBeGreaterThan(0);

    // Simulate rate limit hitting at t = 15s
    rateLimited = true;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.retryAfterMs()).toBeGreaterThan(0);

    const requestsAfterRateLimit = requestCount;
    // Advance 30s (during rate limit) -> NO requests should be sent at all!
    await vi.advanceTimersByTimeAsync(30_000);
    expect(requestCount).toBe(requestsAfterRateLimit);

    sync.stop();
  });
});
