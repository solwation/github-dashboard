import { expect, test, type Page } from "@playwright/test";

async function cacheExists(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("issueflow-vault", 1); request.onsuccess = () => resolve(request.result); });
    try {
      return await new Promise<boolean>(resolve => { const request = db.transaction("credentials").objectStore("credentials").get("content"); request.onsuccess = () => resolve(Boolean(request.result)); });
    } finally { db.close(); }
  });
}
async function setup(page: Page) {
  const repo = { id: 1, name: "test", full_name: "sample/test", private: true, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
  let title = "Cached private fixture";
  let blocked = false;
  let offline = false;
  let release: (() => void) | undefined;
  let conditional = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (blocked && url.pathname === "/user") await new Promise<void>(resolve => { release = resolve; });
    if (offline) { await route.abort("failed"); return; }
    if (url.pathname === "/graphql") { await route.fulfill({ json: { data: { repository: { issue: null } } } }); return; }
    const etag = '"' + url.pathname + (url.pathname.endsWith("/issues") ? title : "stable") + '"';
    if (route.request().headers()["if-none-match"]) conditional++;
    if (route.request().headers()["if-none-match"] === etag) { await route.fulfill({ status: 304 }); return; }
    await route.fulfill({ headers: { etag, "access-control-expose-headers": "etag" }, json: url.pathname === "/user" ? { login: "cache-test", avatar_url: "" } : url.pathname === "/user/repos" ? [repo] : url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open" ? [{ id: 1, number: 1, title, body: "Private cached fixture description", comments: 0, state: "open", closed_at: null, created_at: "2026-01-01T12:00:00Z", updated_at: new Date().toISOString(), html_url: `${repo.html_url}/issues/1`, labels: [], assignees: [] }] : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-cache-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".issue-title")).toContainText(title);
  await expect.poll(() => cacheExists(page)).toBe(true);
  return { block() { blocked = true; }, refresh() { title = "Fresh private fixture"; }, release() { blocked = false; release?.(); }, offline() { offline = true; }, conditional() { return conditional; } };
}

test("renders encrypted content before GitHub responds, then revalidates using persisted ETags", async ({ page }) => {
  const state = await setup(page);
  const encrypted = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("issueflow-vault", 1); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<{ fields: string[]; text: string }>(resolve => { const request = db.transaction("credentials").objectStore("credentials").get("content"); request.onsuccess = () => resolve({ fields: Object.keys(request.result).sort(), text: new TextDecoder().decode(request.result.ciphertext) }); }); } finally { db.close(); }
  });
  expect(encrypted.fields).toEqual(["ciphertext", "iv"]);
  expect(encrypted.text).not.toContain("private fixture");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("private fixture");
  state.block(); state.refresh();
  const cdp = await page.context().newCDPSession(page); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.reload();
  await expect(page.locator(".issue-title")).toContainText("Cached private fixture");
  await expect(page.locator(".cached-content")).toContainText("Visar sparad vy");
  state.release();
  await expect(page.locator(".issue-title")).toContainText("Fresh private fixture");
  await expect(page.locator(".cached-content")).toHaveCount(0);
  expect(state.conditional()).toBeGreaterThanOrEqual(4);
});

test("keeps a cached board during API failure and removes all cached content on confirmed logout", async ({ page }) => {
  const state = await setup(page); state.offline();
  await page.reload();
  await expect(page.locator(".issue-title")).toContainText("Cached private fixture");
  await expect(page.locator(".cached-content")).toBeVisible();
  await expect(page.getByRole("button", { name: "Logga ut", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("cache");
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  expect(await cacheExists(page)).toBe(false);
  await page.reload();
  await expect(page.locator(".issue-card")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toBeVisible();
});

test("changed credentials invalidate cached content and pending writes cannot undo logout", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const path = "/src/lib/vault.ts";
    const vault = await import(/* @vite-ignore */ path);
    await vault.saveToken("another-fixture-token");
    if (await vault.loadContent("fixture-cache-token") !== null) throw new Error("Credential isolation failed");
    if (await vault.loadContent("another-fixture-token") !== null) throw new Error("Old cache retained");
    await Promise.all([vault.saveContent("another-fixture-token", { fixture: true }), vault.clearToken()]);
    if (await vault.loadToken() !== null) throw new Error("Logout lost");
  });
  expect(await cacheExists(page)).toBe(false);
});
test("damaged ciphertext is ignored while the saved PAT still signs in", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("issueflow-vault", 1); request.onsuccess = () => resolve(request.result); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("credentials", "readwrite");
      tx.objectStore("credentials").put({ iv: new Uint8Array(12), ciphertext: new Uint8Array([0]).buffer }, "content");
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    }); } finally { db.close(); }
  });
  await page.reload();
  await expect(page.locator(".issue-title")).toContainText("Cached private fixture");
  await expect(page.locator(".cached-content")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Logga ut", exact: true })).toBeVisible();
});
