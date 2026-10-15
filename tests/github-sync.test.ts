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
