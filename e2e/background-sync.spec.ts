import { expect, test, type Worker } from "@playwright/test";
import { readSettings } from "./support/settings";
import { previewOrigin } from "./ports";

// Background notifications (#129–#131): the installed PWA's service worker checks GitHub on
// periodicsync. Browsers schedule the event themselves, so the test dispatches it in the worker.
// The default headless shell denies Notification permission to service workers even after grantPermissions; the full Chromium (new headless) honors it.
test.use({ baseURL: previewOrigin, channel: "chromium" });
const app = "/github-dashboard/";
const TAG = "issueflow-check";
const repo = { id: 31, name: "alpha", full_name: "sample/alpha", description: "Fictional background fixture", private: true, html_url: "https://github.com/sample/alpha", owner: { login: "sample" } };

/** Fires periodicsync in the worker and waits for its waitUntil work. A synthetic event may not
 * call the native waitUntil (only trusted events can), so the promise is captured instead. */
function fire(worker: Worker, count = 1) {
  return worker.evaluate(async ({ tag, count }) => {
    const work: Promise<unknown>[] = [];
    for (let index = 0; index < count; index++) {
      const event = Object.assign(new Event("periodicsync"), { tag, waitUntil: (promise: Promise<unknown>) => work.push(promise) });
      self.dispatchEvent(event);
    }
    return Promise.all(work);
  }, { tag: TAG, count });
}
const notifications = (worker: Worker) => worker.evaluate(async () =>
  (await (self as unknown as ServiceWorkerGlobalScope).registration.getNotifications())
    .map(notification => ({ title: notification.title, body: notification.body, tag: notification.tag })));

test("simulated periodic sync shows one notification per change from the encrypted background state", async ({ page, context }) => {
  const base = new URL(app, previewOrigin).href;
  await context.grantPermissions(["notifications"], { origin: previewOrigin });
  const created = new Date(Date.now() - 3600_000).toISOString();
  const issue = { id: 9101, number: 12, title: "Fictional background task", state: "open", created_at: created, updated_at: created, closed_at: null as string | null, labels: [], assignees: [], html_url: `${repo.html_url}/issues/12` };
  const seen: string[] = [];
  // Context-level routing also answers the service worker's own GitHub requests.
  await context.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    seen.push(url.pathname + url.search);
    if (url.pathname === "/user") return route.fulfill({ json: { login: "background-sample", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname === "/repos/sample/alpha") return route.fulfill({ json: repo });
    if (url.pathname === "/repos/sample/alpha/issues") {
      const state = url.searchParams.get("state");
      const matches = state === "all" || state === issue.state;
      return route.fulfill({ json: matches ? [{ ...issue }] : [] });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto(app);
  // Legacy settings are migrated into the encrypted per-account store on sign-in.
  await page.evaluate(() => localStorage.setItem("issueflow:background-sample", JSON.stringify({ selected: ["sample/alpha"], notificationRepos: ["sample/alpha"] })));
  await page.reload();
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-background-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".repo-lane h2 a")).toHaveText(["alpha"]);
  await expect.poll(() => readSettings(page, "background-sample").then(saved => saved?.notificationRepos)).toEqual(["sample/alpha"]);
  await page.evaluate(() => navigator.serviceWorker.ready);
  const worker = context.serviceWorkers().find(candidate => candidate.url() === new URL("sw.js", base).href)
    ?? await context.waitForEvent("serviceworker", candidate => candidate.url() === new URL("sw.js", base).href);

  // The first check is a silent baseline, saved as an encrypted vault record.
  await fire(worker);
  expect(await notifications(worker)).toEqual([]);
  // Without a visible window, the next fire compares against the encrypted baseline.
  await page.close();
  expect(await worker.evaluate(async () => (await (self as unknown as ServiceWorkerGlobalScope).clients.matchAll({ type: "window", includeUncontrolled: true })).length)).toBe(0);
  const before = seen.length;
  await fire(worker);
  expect(await notifications(worker)).toEqual([]);
  expect(seen.slice(before).some(path => path.startsWith("/repos/sample/alpha/issues?state=all&") && path.includes("since="))).toBe(true);

  const closed = new Date().toISOString();
  Object.assign(issue, { state: "closed", closed_at: closed, updated_at: closed });
  // Overlapping fires share one check, so the change is announced exactly once.
  await fire(worker, 2);
  const expected = [{ title: "alpha · Issue stängd", body: "#12 Fictional background task", tag: `sample/alpha:9101:${closed}` }];
  expect(await notifications(worker)).toEqual(expected);
  // Later checks without new changes do not repeat it.
  await fire(worker);
  expect(await notifications(worker)).toEqual(expected);
  // Encrypted background state only: no repository names or issue content in caches.
  const cached = await worker.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) urls.push(...(await (await caches.open(name)).keys()).map(request => request.url));
    return urls;
  });
  expect(cached.some(url => url.includes("api.github.com"))).toBe(false);
});
