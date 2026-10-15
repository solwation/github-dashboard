import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
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
afterEach(() => vi.unstubAllGlobals());
describe("GitHub transport", () => {
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
