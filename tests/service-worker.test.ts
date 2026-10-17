import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function shell(clients: Record<string, unknown> = {}) {
  const listeners = new Map<string, (event: any) => void>();
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn().mockResolvedValue(new Response("offline shell")) };
  const fetch = vi.fn().mockResolvedValue(new Response("new shell"));
  const claim = vi.fn().mockResolvedValue(undefined);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const cacheStorage = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue(["issueflow-shell-old", "unrelated-cache"]), delete: vi.fn().mockResolvedValue(true) };
  const source = readFileSync(new URL("../scripts/service-worker.js", import.meta.url), "utf8")
    .replace("__CACHE_VERSION__", "test")
    .replace("__SHELL_FILES__", JSON.stringify(["./", "./assets/app-test.js"]));
  runInNewContext(source, {
    URL, Request, fetch,
    self: { location: { href: "https://example.test/board/sw.js" }, clients: { claim, ...clients }, skipWaiting, addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener) },
    caches: cacheStorage,
  });
  return { listeners, cache, fetch, claim, skipWaiting, cacheStorage };
}
describe("public service-worker shell", () => {
  it("claims existing tabs before optional cleanup, tolerating cache deletion failures", async () => {
    const { listeners, claim, cacheStorage } = shell();
    cacheStorage.delete.mockRejectedValueOnce(new Error("cache storage unavailable"));
    let activated!: Promise<unknown>;
    listeners.get("activate")!({ waitUntil: (work: Promise<unknown>) => activated = work });
    await expect(activated).resolves.toBeUndefined();
    expect(claim).toHaveBeenCalledOnce();
    expect(cacheStorage.delete).toHaveBeenCalledWith("issueflow-shell-old");
    expect(claim.mock.invocationCallOrder[0]).toBeLessThan(cacheStorage.delete.mock.invocationCallOrder[0]!);
  });
  it("extends activation-message lifetime and supports retrying a missing controller claim", async () => {
    const { listeners, claim, skipWaiting } = shell();
    let work!: Promise<unknown>;
    listeners.get("message")!({ data: { type: "SKIP_WAITING" }, waitUntil: (promise: Promise<unknown>) => work = promise });
    await work;
    expect(skipWaiting).toHaveBeenCalledOnce();
    listeners.get("message")!({ data: { type: "CLAIM_CLIENTS" }, waitUntil: (promise: Promise<unknown>) => work = promise });
    await work;
    expect(claim).toHaveBeenCalledOnce();
  });
  it("rejects incomplete shell installation and leaves existing shell caches intact", async () => {
    const { listeners, cache, cacheStorage, claim } = shell();
    cache.addAll.mockRejectedValueOnce(new Error("deployment asset missing"));
    let installed!: Promise<unknown>;
    listeners.get("install")!({ waitUntil: (work: Promise<unknown>) => installed = work });
    await expect(installed).rejects.toThrow("deployment asset missing");
    expect(cacheStorage.delete).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });
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
  it("focuses the open app at the issue lane for background-check notifications, or opens it", async () => {
    const client = { url: "https://example.test/board/#overview", focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockResolvedValue(undefined) };
    const matchAll = vi.fn().mockResolvedValue([client]);
    const openWindow = vi.fn().mockResolvedValue(undefined);
    const { listeners } = shell({ matchAll, openWindow });
    const click = async (data: unknown) => {
      let work: Promise<unknown> = Promise.resolve();
      const close = vi.fn();
      listeners.get("notificationclick")!({ notification: { data, close }, waitUntil: (promise: Promise<unknown>) => work = promise });
      await work;
      expect(close).toHaveBeenCalledOnce();
    };
    await click({ app: "https://example.test/board/#repo-7", url: "https://github.com/acme/board/issues/1" });
    expect(client.focus).toHaveBeenCalledOnce();
    expect(client.navigate).toHaveBeenCalledWith("https://example.test/board/#repo-7");
    expect(openWindow).not.toHaveBeenCalled();
    matchAll.mockResolvedValueOnce([]);
    await click({ app: "https://example.test/board/#repo-7" });
    expect(openWindow).toHaveBeenCalledWith("https://example.test/board/#repo-7");
    // Foreign or query-bearing app targets are ignored; GitHub issue links keep opening GitHub.
    openWindow.mockClear();
    await click({ app: "https://attacker.test/board/#repo-7" });
    await click({ app: "https://example.test/board/?code=secret" });
    expect(openWindow).not.toHaveBeenCalled();
    await click({ url: "https://github.com/acme/board/issues/1" });
    expect(openWindow).toHaveBeenCalledWith("https://github.com/acme/board/issues/1");
  });
});
