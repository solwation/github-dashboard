import { expect, test } from "@playwright/test";

// #122: background syncs that GitHub answers with 304 keep the shown lanes and do not rewrite the
// encrypted content cache. persistContent() skips only when every lane object is the one already
// written, so a write count of zero also shows that the lanes were not replaced.
test("unchanged background syncs keep the encrypted cache and lanes, a real change writes once", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    const counter = { content: 0 };
    Object.assign(window, { contentWrites: counter });
    IDBObjectStore.prototype.put = function(value, key) {
      if (key === "content") counter.content++;
      return put.call(this, value, key);
    };
  });
  const repo = { id: 1, name: "test", full_name: "sample/test", private: true, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
  let title = "Active fixture";
  let updated = "2026-10-16T10:00:00Z";
  let syncs = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/graphql") { await route.fulfill({ json: { data: { repository: { issue: null } } } }); return; }
    if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "all") syncs++;
    const etag = `"${url.pathname}${url.searchParams.get("state") ?? ""}${url.pathname.endsWith("/issues") ? title : ""}"`;
    if (route.request().headers()["if-none-match"] === etag) { await route.fulfill({ status: 304 }); return; }
    const issue = { id: 1, number: 1, title, body: "", comments: 0, state: "open", closed_at: null, created_at: "2026-10-01T12:00:00Z", updated_at: updated,
      html_url: `${repo.html_url}/issues/1`, labels: [{ name: "In progress", color: "ededed" }], assignees: [] };
    const json = url.pathname === "/user" ? { login: "sync-test", avatar_url: "" } : url.pathname === "/user/repos" ? [repo]
      : url.pathname.endsWith("/labels") ? [{ name: "In progress", color: "ededed" }]
      : url.pathname.endsWith("/events") ? [{ id: 1, event: "labeled", created_at: "2026-10-16T09:00:00Z", label: { name: "In progress" } }]
      : url.pathname.endsWith("/issues") && url.searchParams.get("state") !== "closed" ? [issue] : [];
    await route.fulfill({ headers: { etag, "access-control-expose-headers": "etag" }, json });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-sync-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".issue-title")).toContainText(title);
  const writes = () => page.evaluate(() => (window as unknown as { contentWrites: { content: number } }).contentWrites.content);
  await expect.poll(writes).toBeGreaterThan(0);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  const initial = await writes();
  // Ten minutes of 15-second active syncs, every one answered 304.
  for (let tick = 0; tick < 40; tick++) {
    const before = syncs;
    await page.clock.fastForward(15_000);
    await expect.poll(() => syncs).toBeGreaterThan(before);
    await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
    if (tick === 15) expect(await writes()).toBe(initial);
  }
  // Only the low-frequency syncedAt refresh may write (at most once per five minutes).
  expect(await writes() - initial).toBeLessThanOrEqual(2);
  const unchanged = await writes();
  title = "Changed fixture"; updated = "2026-10-16T11:00:00Z";
  await page.clock.fastForward(15_000);
  await expect(page.locator(".issue-title")).toContainText("Changed fixture");
  await expect.poll(writes).toBe(unchanged + 1);
});
