import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import type { Issue, Lane, Repo } from "../src/lib/model";
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
});
