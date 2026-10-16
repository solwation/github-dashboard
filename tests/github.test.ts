import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import { setLanguage } from "../src/lib/i18n";
import type { Repo } from "../src/lib/model";
const repo: Repo = {
  id: 1,
  name: "test",
  full_name: "owner/test",
  description: null,
  private: true,
  html_url: "https://github.com/owner/test",
  owner: { login: "owner" },
};
const issue = {
  id: 1,
  number: 1,
  title: "Private title",
  state: "open",
  labels: [{ name: "in-progress", color: "fff" }],
  created_at: "2026-01-01",
  assignees: [],
};
afterEach(() => { vi.unstubAllGlobals(); setLanguage("auto"); });
describe("GitHub transport", () => {
  it("explains a 403 permission denial without a retry time even when GitHub sends X-RateLimit-Reset", async () => {
    setLanguage("en");
    const reset = String(Math.floor(Date.now() / 1000) + 1800);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ message: "Resource not accessible by personal access token" }),
      { status: 403, headers: { "x-ratelimit-remaining": "4999", "x-ratelimit-reset": reset } },
    )));
    const client = new GitHub("test-token");
    const error = await client.request("/repos/owner/test/issues").catch((caught) => caught);
    expect(error).toMatchObject({ status: 403, permissionDenied: true, rateLimited: false });
    expect(error.message).toBe("Access denied. Check your token permissions.");
    expect(client.retryAfterMs()).toBe(0);
    setLanguage("sv");
    await expect(client.request("/repos/owner/test/issues")).rejects.toThrow(/^Åtkomst nekad\. Kontrollera tokenens behörigheter\.$/);
  });
  it("shows the retry time only for genuine 403/429 rate limits", async () => {
    setLanguage("en");
    const resetAt = (Math.floor(Date.now() / 1000) + 1800) * 1000;
    const time = (ms: number) => new Date(ms).toLocaleTimeString("en-GB");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "API rate limit exceeded" }),
        { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetAt / 1000) } }))
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "retry-after": "60", "x-ratelimit-remaining": "10" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 429 })));
    const exhausted = await new GitHub("test-token").request("/user").catch((caught) => caught);
    expect(exhausted).toMatchObject({ status: 403, rateLimited: true, permissionDenied: false });
    expect(exhausted.message).toBe(`GitHub API rate limit reached. Try again after ${time(resetAt)}.`);
    const secondary = new GitHub("test-token");
    const before = Date.now();
    const retried = await secondary.request("/user").catch((caught) => caught);
    expect(retried).toMatchObject({ status: 429, rateLimited: true });
    expect(retried.message).toMatch(/^GitHub API rate limit reached\. Try again after .+\.$/);
    expect(secondary.retryAfterMs()).toBeGreaterThan(59000);
    expect([time(before + 60000), time(Date.now() + 60000)]).toContain(retried.message.match(/after (.+)\.$/)[1]);
    const unknown = await new GitHub("test-token").request("/user").catch((caught) => caught);
    expect(unknown.message).toBe("GitHub API rate limit reached. Try again later.");
  });
  it("distinguishes an empty Git repository from other conflict responses", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Git Repository is empty." }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Conflict" }), { status: 409 })));
    const client = new GitHub("test-token");
    await expect(client.request("/repos/owner/test/commits")).rejects.toMatchObject({ status: 409, emptyRepository: true });
    await expect(client.request("/repos/owner/test/commits")).rejects.toMatchObject({ status: 409, emptyRepository: false });
  });
  it("follows pagination and sends credentials only to the GitHub API", async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([repo]), {
          headers: {
            Link: '<https://api.github.com/user/repos?page=2>; rel="next"',
          },
        }),
      )
      .mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", mock);
    expect(await new GitHub("test-token").repos()).toEqual([repo]);
    expect(mock).toHaveBeenCalledTimes(2);
    await expect(
      new GitHub("test-token").request("https://example.com/steal"),
    ).rejects.toThrow(/Ogiltig|Invalid/);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it("keeps active issues when timeline access fails and marks the timer unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith("/events"))
          return new Response("{}", { status: 403 });
        if (url.pathname.endsWith("/labels")) return new Response("[]");
        return new Response(
          JSON.stringify(
            url.searchParams.get("state") === "open" ? [issue] : [],
          ),
        );
      }),
    );
    const lane = await new GitHub("test-token").lane(repo, {});
    expect(lane.issues).toHaveLength(1);
    expect(lane.timerWarning).toBe(true);
    expect(lane.issues[0]?.startedAt).toBeUndefined();
  });
  it("does not keep a transient timeline error in cached issues across 304 responses", async () => {
    let timelineFails = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        if (url.pathname.endsWith("/events")) {
          if (timelineFails) return new Response("{}", { status: 500 });
          return new Response(JSON.stringify([{ event: "labeled", label: { name: "in-progress" }, created_at: "2026-10-15T09:00:00Z" }]));
        }
        if ((init.headers as Record<string, string>)["If-None-Match"])
          return new Response(null, { status: 304 });
        const body = url.pathname.endsWith("/labels") ? []
          : url.searchParams.get("state") === "open" ? [issue] : [];
        return new Response(JSON.stringify(body), { headers: { etag: `"${url.search}"` } });
      }),
    );
    const client = new GitHub("test-token");
    const failed = await client.lane(repo, {});
    expect(failed.timerWarning).toBe(true);
    expect(failed.issues[0]?.timerError).toBe(true);
    timelineFails = false;
    const recovered = await client.lane(repo, {});
    expect(recovered.timerWarning).toBe(false);
    expect(recovered.issues[0]?.timerError).toBe(false);
    expect(recovered.issues[0]?.startedAt).toBe("2026-10-15T09:00:00Z");
    const exported = JSON.stringify(client.exportResponses());
    expect(exported).not.toContain("startedAt");
    expect(exported).not.toContain("timerError");
  });
  it("fully paginates history to find the latest resumed interval and excludes PRs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        if (url.pathname.endsWith("/labels")) return new Response("[]");
        if (url.pathname.endsWith("/events"))
          return url.searchParams.get("page") === "2"
            ? new Response(
                JSON.stringify([
                  {
                    id: 3,
                    event: "labeled",
                    created_at: "2026-10-15T09:00:00Z",
                    label: { name: "in-progress" },
                  },
                ]),
              )
            : new Response(
                JSON.stringify([
                  {
                    id: 1,
                    event: "labeled",
                    created_at: "2026-01-01",
                    label: { name: "in-progress" },
                  },
                  {
                    id: 2,
                    event: "unlabeled",
                    created_at: "2026-01-02",
                    label: { name: "in-progress" },
                  },
                ]),
                {
                  headers: {
                    Link: '<https://api.github.com/repos/owner/test/issues/1/events?page=2>; rel="next"',
                  },
                },
              );
        return new Response(
          JSON.stringify(
            url.searchParams.get("state") === "open"
              ? [issue, { ...issue, id: 2, pull_request: {} }]
              : [],
          ),
        );
      }),
    );
    const lane = await new GitHub("test-token").lane(repo, {});
    expect(lane.issues).toHaveLength(1);
    expect(lane.issues[0]?.startedAt).toBe("2026-10-15T09:00:00Z");
  });
});
