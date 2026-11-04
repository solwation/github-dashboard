import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub, GitHubApiError } from "../src/lib/github";
import { PROJECT_ICON_MAX_BYTES, ProjectIconResolver, projectIconData, safeProjectSvg } from "../src/lib/project-icon";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const data = "data:image/png;base64," + png;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#147d69"/></svg>';
const dir = (name: string, parent = "") => ({ name, path: parent + name, type: "dir" });
const file = (name: string, parent = "", size = 100) => ({ name, path: parent + name, type: "file", size });
afterEach(() => vi.unstubAllGlobals());
describe("project artwork discovery and security", () => {
  it("caches confirmed missing optional access across restore without caching a rate limit as missing artwork", async () => {
    vi.useFakeTimers();
    try {
      const denied = vi.fn(async () => { throw new GitHubApiError("Missing Contents access", 403, true, false); });
      const icons = new ProjectIconResolver(denied);
      const metadata = await icons.get("sample/private");
      expect(metadata?.data).toBeNull();
      vi.advanceTimersByTime(5 * 60_000 + 1);
      await icons.get("sample/private");
      const restored = new ProjectIconResolver(denied);
      restored.restore([{ full_name: "sample/private", projectIcon: metadata! }]);
      await restored.get("sample/private");
      expect(denied).toHaveBeenCalledOnce();
      const limited = vi.fn(async () => { throw new GitHubApiError("Rate limited", 403, false, true); });
      expect(await new ProjectIconResolver(limited).get("sample/private")).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("discovers repository-specific SVG names through bounded directory metadata, rasterizes and caches missing/success results", async () => {
    const request = vi.fn(async (path: string) => path.endsWith("/contents") ? [dir("assets")]
      : path.endsWith("/contents/assets") ? [file("boosterai.svg", "assets/")]
      : { ...file("boosterai.svg", "assets/"), encoding: "base64", content: btoa(svg) });
    const rasterize = vi.fn(async () => data);
    const icons = new ProjectIconResolver(request, () => true, rasterize);
    expect((await icons.get("sample/booster-ai"))!.data).toBe(data);
    expect((await icons.get("sample/booster-ai"))!.data).toBe(data);
    expect(request.mock.calls.map(call => call[0])).toEqual(["/repos/sample/booster-ai/contents", "/repos/sample/booster-ai/contents/assets", "/repos/sample/booster-ai/contents/assets/boosterai.svg"]);
    expect(rasterize).toHaveBeenCalledOnce();
    const missing = vi.fn(async () => [dir("public"), dir("assets"), dir("icons"), dir("icons", "public/"), dir("assets", "public/")]);
    const empty = new ProjectIconResolver(missing);
    expect((await empty.get("sample/empty"))!.data).toBeNull();
    await empty.get("sample/empty");
    expect(missing.mock.calls.length).toBeLessThanOrEqual(6);
  });
  it("expires same-client cache entries after a day and retries transient errors after a bounded cooldown", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn(async () => []);
      const icons = new ProjectIconResolver(request);
      await icons.get("sample/project"); await icons.get("sample/project"); expect(request).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(24 * 3600_000 + 1); await icons.get("sample/project"); expect(request).toHaveBeenCalledTimes(2);
      request.mockRejectedValueOnce(new Error("Temporary network failure"));
      expect(await icons.get("sample/transient")).toBeNull();
      await icons.get("sample/transient"); expect(request).toHaveBeenCalledTimes(3);
      vi.advanceTimersByTime(5 * 60_000 + 1); expect((await icons.get("sample/transient"))?.data).toBeNull(); expect(request).toHaveBeenCalledTimes(4);
      expect(safeProjectSvg('<?xml version="1.0"?>\n<!-- Generated icon -->' + svg)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("rejects active/external SVG, oversized/spoofed files and arbitrary addresses without following download URLs", async () => {
    for (const unsafe of [svg.replace("<rect", '<script>alert(1)</script><rect'), svg.replace("<rect", '<foreignObject/><rect'), svg.replace("<rect", '<image href="https://external.invalid/private"/><rect'), svg.replace("<rect", '<use href="https://external.invalid/icon.svg#icon"/><rect'), svg.replace("<rect", '<rect onload="alert(1)"/><rect'), svg.replace("<rect", '<style>@import "https://external.invalid";</style><rect'), svg.replace("<rect", '<use href="&#104;ttps://external.invalid"/><rect')]) expect(safeProjectSvg(unsafe)).toBe(false);
    expect(safeProjectSvg(svg)).toBe(true);
    expect(projectIconData("https://external.invalid/avatar.png?token=private")).toBeNull();
    expect(projectIconData("data:image/svg+xml;base64," + btoa(svg))).toBeNull();
    expect(projectIconData("data:image/png;base64," + btoa("<script>unsafe</script>"))).toBeNull();
    expect(projectIconData(data)).toBe(data);
    const request = vi.fn(async () => [file("icon.png", "", PROJECT_ICON_MAX_BYTES + 1)]);
    const icons = new ProjectIconResolver(request);
    expect((await icons.get("sample/empty"))!.data).toBeNull();
    await icons.get("https://external.invalid/private");
    expect(request).toHaveBeenCalledOnce();
  });
  it("uses authenticated no-store Contents reads, encrypted metadata reuse and separate client caches; quota reserve skips optional requests", async () => {
    const repo = { id: 1, full_name: "sample/project", name: "project", private: true, description: null, html_url: "https://github.com/sample/project", owner: { login: "sample" } };
    const fetcher = vi.fn(async (_url: any, init: any) => new Response(JSON.stringify(String(_url).endsWith("/contents") ? [file("favicon.png")] : { ...file("favicon.png"), encoding: "base64", content: png, download_url: "https://external.invalid/?private-token" }), { headers: { etag: '"icon"' } }));
    vi.stubGlobal("fetch", fetcher);
    const first = new GitHub("account-one-token");
    expect((await first.projectIcon(repo))!.data).toBe(data);
    await first.projectIcon(repo);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/api.github.com\/repos\/sample\/project\/contents/);
      expect(init.cache).toBe("no-store"); expect(init.headers.Authorization).toBe("Bearer account-one-token");
    }
    const cached = await first.projectIcon(repo);
    const restored = new GitHub("account-one-token"); restored.restoreProjectIcons([{ ...repo, projectIcon: cached! }]);
    await restored.projectIcon(repo); expect(fetcher).toHaveBeenCalledTimes(2);
    await new GitHub("account-two-token").projectIcon(repo); expect(fetcher).toHaveBeenCalledTimes(4);
    const limited = new GitHub("account-three-token");
    fetcher.mockImplementationOnce(async () => new Response("{}", { headers: { "x-ratelimit-remaining": "10", "x-ratelimit-limit": "5000", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600) } }));
    await limited.request("/user");
    expect(await limited.projectIcon(repo)).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(5);
  });
});
