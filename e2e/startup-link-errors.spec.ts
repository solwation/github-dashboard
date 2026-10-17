import { expect, test, type Page } from "@playwright/test";
import { createHandoffUrl, HANDOFF_LIFETIME_MS } from "../src/lib/handoff";

const accounts: Record<string, string> = { "fixture-saved-token": "saved-account", "fixture-foreign-token": "foreign-account" };
const repo = { id: 1, name: "test", full_name: "sample/test", private: true, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
/** Tokens listed in `failing` get a GitHub API outage; `offline` aborts every request. */
async function fixture(page: Page, failing: Set<string>, state = { offline: false }) {
  await page.route("https://api.github.com/**", route => {
    const path = new URL(route.request().url()).pathname;
    const token = (route.request().headers().authorization || "").replace(/^Bearer /, "");
    if (state.offline) return route.abort("internetdisconnected");
    if (failing.has(token) && path !== "/user") return route.fulfill({ status: 503, json: { message: "Service unavailable" } });
    return route.fulfill({ json: path === "/user" ? { login: accounts[token] ?? "unknown", avatar_url: "" } : path === "/user/repos" ? [repo] : [] });
  });
  return state;
}
const link = (token: string, now = Date.now()) =>
  createHandoffUrl("http://127.0.0.1:5173/", { token, selected: ["sample/test"], rules: {} }, now).url;
async function start(page: Page, url: string) {
  // Leave the document first so a hash-only change performs a real application start.
  await page.goto("about:blank");
  await page.goto(url);
}
async function cacheExists(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("issueflow-vault", 1); request.onsuccess = () => resolve(request.result); });
    try {
      return await new Promise<boolean>(resolve => { const request = db.transaction("credentials").objectStore("credentials").get("content"); request.onsuccess = () => resolve(Boolean(request.result)); });
    } finally { db.close(); }
  });
}
async function expectSavedBoard(page: Page) {
  await expect(page.locator(".username")).toHaveText("saved-account");
  await expect(page.locator(".repo-lane")).toHaveCount(1);
}

test("an expired handoff link shows its error over the restored saved session", async ({ page }) => {
  await fixture(page, new Set());
  await start(page, link("fixture-saved-token"));
  await expectSavedBoard(page);

  await start(page, link("fixture-foreign-token", Date.now() - 2 * HANDOFF_LIFETIME_MS));
  await expect(page.locator(".notice.error")).toHaveText(/Överföringslänken har gått ut\. Den gäller i fem minuter – skapa en ny QR-kod på den andra enheten\./);
  expect(page.url()).not.toContain("issueflow-handoff");
  await expectSavedBoard(page);
  await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toHaveCount(0);
});

test("rejected handoff links explain expired and invalid codes in English", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("issueflow-language", "en"));
  await fixture(page, new Set());
  await start(page, link("fixture-saved-token"));
  await expectSavedBoard(page);

  await start(page, link("fixture-foreign-token", Date.now() - 2 * HANDOFF_LIFETIME_MS));
  await expect(page.locator(".notice.error")).toContainText("The transfer link has expired. Links are valid for five minutes – create a new QR code on the other device.");
  await start(page, "http://127.0.0.1:5173/#issueflow-handoff=1234");
  await expect(page.locator(".notice.error")).toContainText("The transfer link is invalid or incomplete. Create a new QR code on the other device.");
  expect(page.url()).not.toContain("issueflow-handoff");
  await expectSavedBoard(page);
});

test("a cancelled or unverifiable OAuth return keeps the saved session and scrubs the address", async ({ page }) => {
  await fixture(page, new Set());
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await start(page, link("fixture-saved-token"));
  await expectSavedBoard(page);

  await start(page, "/?error=access_denied&state=fixture-state");
  await expect(page.locator(".notice.error")).toContainText("GitHub-inloggningen avbröts.");
  expect(page.url()).not.toContain("error=");
  await expectSavedBoard(page);

  await start(page, "/?code=fixture-oauth-code&state=fixture-state");
  await expect(page.locator(".notice.error")).toContainText("Inloggningen kunde inte verifieras");
  expect(page.url()).not.toContain("fixture-oauth-code");
  expect(requests.filter(url => url.includes("fixture-oauth-code") && !url.startsWith("http://127.0.0.1:5173/"))).toEqual([]);
  await expectSavedBoard(page);
});

test("a confirmed switch whose incoming token fails to connect restores the saved board", async ({ page }) => {
  await fixture(page, new Set(["fixture-foreign-token"]));
  await start(page, link("fixture-saved-token"));
  await expectSavedBoard(page);

  await start(page, link("fixture-foreign-token"));
  const dialog = page.getByRole("dialog", { name: "Byta GitHub-konto?", exact: true });
  await dialog.getByRole("button", { name: "Byt konto", exact: true }).click();
  await expect(page.locator(".notice.error")).toContainText("GitHub svarade 503");
  await expectSavedBoard(page);
  await page.reload();
  await expectSavedBoard(page);
});

test("a handoff link for the saved token opened offline falls back to the cached board", async ({ page }) => {
  const state = await fixture(page, new Set());
  await start(page, link("fixture-saved-token"));
  await expectSavedBoard(page);

  await expect.poll(() => cacheExists(page)).toBe(true);
  state.offline = true;
  await start(page, link("fixture-saved-token"));
  await expect(page.locator(".notice.error")).toBeVisible();
  await expectSavedBoard(page);
  await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toHaveCount(0);
});
