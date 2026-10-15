import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function shell() {
  const listeners = new Map<string, (event: any) => void>();
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn().mockResolvedValue(new Response("offline shell")) };
  const fetch = vi.fn().mockResolvedValue(new Response("new shell"));
  const source = readFileSync(new URL("../scripts/service-worker.js", import.meta.url), "utf8")
    .replace("__CACHE_VERSION__", "test")
    .replace("__SHELL_FILES__", JSON.stringify(["./", "./assets/app-test.js"]));
  runInNewContext(source, {
    URL, Request, fetch,
    self: { location: { href: "https://example.test/board/sw.js" }, addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener) },
    caches: { open: vi.fn().mockResolvedValue(cache) },
  });
  return { listeners, cache, fetch };
}
describe("public service-worker shell", () => {
  it("installs fresh shell bytes even while the previous deployment's HTML is HTTP cached", async () => {
    const { listeners, cache } = shell();
    let installed!: Promise<unknown>;
    listeners.get("install")!({ waitUntil: (work: Promise<unknown>) => installed = work });
    await installed;
    const requests = cache.addAll.mock.calls[0]![0] as Request[];
    expect(requests.map((request) => request.url)).toEqual(["https://example.test/board/", "https://example.test/board/assets/app-test.js"]);
    expect(requests.every((request) => request.cache === "reload")).toBe(true);
  });
  it("bypasses fresh HTTP-cached navigation but retains the installed app offline", async () => {
    const { listeners, fetch } = shell();
    const request = new Request("https://example.test/board/");
    Object.defineProperty(request, "mode", { value: "navigate" });
    let response!: Promise<Response>;
    const event = { request, respondWith: (work: Promise<Response>) => response = work };
    listeners.get("fetch")!(event);
    expect(await (await response).text()).toBe("new shell");
    expect(fetch.mock.calls[0]![0].cache).toBe("reload");
    fetch.mockRejectedValueOnce(new Error("offline"));
    listeners.get("fetch")!(event);
    expect(await (await response).text()).toBe("offline shell");
  });
  it("leaves API, authorization, callback/query, cross-origin and non-allowlisted requests outside shell caching", () => {
    const { listeners, fetch, cache } = shell();
    for (const request of [
      new Request("https://api.github.com/user"),
      new Request("https://example.test/board/?code=secret"),
      new Request("https://example.test/board/assets/app-test.js?token=secret"),
      new Request("https://example.test/board/", { headers: { Authorization: "Bearer test-only" } }),
      new Request("https://example.test/board/private.json"),
      new Request("https://example.test/board/", { method: "POST" }),
    ]) {
      const respondWith = vi.fn();
      listeners.get("fetch")!({ request, respondWith });
      expect(respondWith).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.match).not.toHaveBeenCalled();
  });
});
