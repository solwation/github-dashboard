/* Public app shell only. Never cache API responses, credentials or callback URLs. */
const CACHE = "issueflow-shell-__CACHE_VERSION__";
const FILES = __SHELL_FILES__;
const root = new URL("./", self.location.href);
const allowed = new Set(FILES.map((path) => new URL(path, root).href));
// Stable shell URLs (especially index.html) may still be fresh in the HTTP cache
// after deployment. A new worker must install the published bytes, not old HTML.
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(
        FILES.map((path) => new Request(new URL(path, root), { cache: "reload" })),
      ),
    ),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Cleanup is optional. A cache-storage failure must never prevent takeover.
      try {
        for (const key of await caches.keys())
          if (key.startsWith("issueflow-shell-") && key !== CACHE)
            await caches.delete(key);
      } catch { /* Keep the installed shell and retry cleanup on a future version. */ }
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
  if (event.data?.type === "CLAIM_CLIENTS") event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== root.origin ||
    url.search ||
    request.headers.has("Authorization")
  )
    return;
  if (
    request.mode === "navigate" &&
    (url.pathname === root.pathname ||
      url.pathname === root.pathname + "index.html")
  ) {
    event.respondWith(
      fetch(new Request(request, { cache: "reload" })).catch(() =>
        caches.open(CACHE).then((cache) => cache.match(root.href)),
      ),
    );
    return;
  }
  if (allowed.has(url.href))
    event.respondWith(
      caches
        .open(CACHE)
        .then(async (cache) => (await cache.match(request, { ignoreVary: true })) || fetch(request)),
    );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url;
  if (typeof target !== "string") return;
  const url = new URL(target);
  if (url.origin === "https://github.com")
    event.waitUntil(self.clients.openWindow(url.href));
});
