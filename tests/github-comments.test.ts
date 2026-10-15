import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";

afterEach(() => vi.unstubAllGlobals());
describe("issue comments", () => {
  it("loads all pages on demand with the signed-in token and no HTTP cache", async () => {
    const first = { id: 1, body: "Private fixture", user: { login: "author" }, created_at: "2026-01-01", html_url: "https://github.com/owner/private/issues/8#issuecomment-1" };
    const second = { ...first, id: 2 };
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([first]), { headers: { Link: '<https://api.github.com/repos/owner/private/issues/8/comments?page=2>; rel="next"' } })).mockResolvedValueOnce(new Response(JSON.stringify([second])));
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("fictional-token");
    expect(fetch).not.toHaveBeenCalled();
    expect(await api.issueComments("owner/private", 8)).toEqual([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![0].href).toBe("https://api.github.com/repos/owner/private/issues/8/comments?per_page=100");
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers.Authorization).toBe("Bearer fictional-token");
      expect(options.cache).toBe("no-store");
      expect(options.method).toBeUndefined();
    }
  });
  it("rejects inaccessible comments and can retry without exposing a partial page", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 403 })).mockResolvedValueOnce(new Response("[]"));
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("fictional-token");
    await expect(api.issueComments("owner/private", 8)).rejects.toThrow();
    await expect(api.issueComments("owner/private", 8)).resolves.toEqual([]);
  });
  it("never follows a pagination link to another origin or accepts a malformed repository", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("[]", { headers: { Link: '<https://attacker.example/comments>; rel="next"' } }));
    vi.stubGlobal("fetch", fetch);
    const api = new GitHub("fictional-token");
    await expect(api.issueComments("owner/private", 8)).rejects.toThrow(/Ogiltig|Invalid/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(() => api.issueComments("owner/private/../../user", 8)).toThrow();
    expect(() => api.issueComments("owner/private", -1)).toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
