import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { readSettings } from "./support/settings";
import { boardSplit } from "./support/board-grouping";
const evidence = process.env.EVENT_HISTORY_EVIDENCE;
const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: true, description: "Synthetic diagnostics fixture", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
async function fixture(page: Page) {
  const failures = new Set(["alpha", "beta"]);
  let login = "history-account";
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      if (failures.has(repo.name)) return route.fulfill({ status: 500, json: { message: `Synthetic ${repo.name} failure: ` + "Long diagnostic context ".repeat(12) } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  return { failures, account(value: string) { login = value; } };
}
async function seed(page: Page, events = false) {
  await page.evaluate(async ({ events, repositories }) => {
    const modulePath = "/src/lib/settings-store.ts";
    const { saveSettings } = await import(modulePath);
    await saveSettings("history-account", {
      selected: repositories,
      eventHistory: events ? { active: [], entries: [
        { source: "fixture-info", severity: "info", message: "Synthetic informational notice", id: 1, timestamp: Date.now() - 2000, seen: false },
        { source: "fixture-warning", severity: "warning", message: "Synthetic warning with a very long unbroken field " + "context".repeat(50), repository: "sample/" + "long-repository-name-".repeat(8), id: 2, timestamp: Date.now() - 1000, seen: false },
      ] } : undefined,
    });
  }, { events, repositories: repos.map(repo => repo.full_name) });
}
async function signIn(page: Page) {
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-event-history-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
}
const historyButton = (page: Page) => page.locator(".event-history-toggle");
const historyDialog = (page: Page) => page.getByRole("dialog", { name: "Händelsehistorik", exact: true });
async function closeHistory(page: Page) { await page.keyboard.press("Escape"); await expect(historyDialog(page)).not.toBeVisible(); }
async function signOut(page: Page) {
  // Desktop direct action; mobile account tools live in the menu.
  if (await page.locator(".mobile-menu-button").isVisible()) await page.locator(".mobile-menu-button").click();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
}
test("groups project failures, deduplicates reloads, keeps new arrivals unseen and retries with a recovery", async ({ page }) => {
  const api = await fixture(page); await seed(page); await signIn(page);
  const summary = page.locator(".project-error-summary");
  await expect(summary).toContainText("2 projektfel");
  await expect(page.locator(".repo-lane .notice.error, .combined-board .notice.error")).toHaveCount(0);
  await expect(historyButton(page)).toHaveAccessibleName("Händelsehistorik, 2 olästa händelser");
  await page.reload();
  await expect(summary).toContainText("2 projektfel");
  await expect.poll(() => readSettings(page, "history-account").then(saved => saved?.eventHistory?.entries.length)).toBe(2);
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(historyDialog(page).locator(".event-current-error")).toHaveCount(2);
  const close = historyDialog(page).getByRole("button", { name: "Stäng händelsehistorik" });
  const lastRetry = historyDialog(page).getByRole("button", { name: "Försök igen" }).last();
  await lastRetry.focus(); await page.keyboard.press("Tab"); await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(lastRetry).toBeFocused();
  if (evidence) await page.screenshot({ path: `${evidence}/events-current-errors-desktop.png` });
  await expect(historyDialog(page).locator(".event-current-error").first()).toContainText("sample/alpha");
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveCount(0);
  api.failures.delete("alpha");
  await historyDialog(page).locator(".event-current-error").first().getByRole("button", { name: "Försök igen" }).click();
  await expect(historyDialog(page).locator(".event-current-error")).toHaveCount(1);
  await expect(historyDialog(page).getByRole("button", { name: "Visa nya händelser" })).toBeVisible();
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveText("1");
  await historyDialog(page).getByRole("button", { name: "Visa nya händelser" }).click();
  await expect(historyDialog(page).locator(".event-history-item").first()).toContainText("Synkroniseringen fungerar igen.");
  await closeHistory(page); await expect(summary).toBeFocused();
  await expect(summary).toContainText("Ett projektfel");
  await boardSplit(page).uncheck();
  await expect(summary).toContainText("Ett projektfel");
  await expect(page.locator(".combined-board .notice.error")).toHaveCount(0);
  await expect.poll(() => readSettings(page, "history-account").then(saved => saved?.eventHistory?.entries.every((item: any) => item.seen))).toBe(true);
});

test("encrypted per-account history survives logout without leaking into another account or public browsing", async ({ page }) => {
  const api = await fixture(page); await seed(page, true); await signIn(page);
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveText("4");
  await expect.poll(() => readSettings(page, "history-account").then(saved => saved?.eventHistory?.entries.length)).toBe(4);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("issueflow-settings", 1); request.onsuccess = () => resolve(request.result); });
    const records = await new Promise<any[]>(resolve => { const request = db.transaction("settings").objectStore("settings").getAll(); request.onsuccess = () => resolve(request.result); });
    db.close();
    return { plaintext: JSON.stringify({ ...localStorage, ...sessionStorage, records }), keyExportable: records.find(record => record instanceof CryptoKey)?.extractable };
  });
  expect(stored.plaintext).not.toContain("Synthetic"); expect(stored.plaintext).not.toContain("sample/"); expect(stored.keyExportable).toBe(false);
  await signOut(page);
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveCount(0);
  api.account("history-other"); await signIn(page);
  await expect(page.getByRole("dialog", { name: "Välj repositories", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Välj repositories", exact: true }).getByRole("button", { name: "Visa översikt" }).click();
  await historyButton(page).click(); await expect(historyDialog(page)).toContainText("Inga händelser ännu."); await closeHistory(page);
  await signOut(page); api.account("history-account"); await signIn(page);
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveText("4");
  await signOut(page);
  await page.getByRole("button", { name: "Följ publika repositories", exact: true }).click();
  await page.getByRole("dialog", { name: "Välj repositories", exact: true }).getByRole("button", { name: "Visa översikt" }).click();
  await historyButton(page).click(); await expect(historyDialog(page)).toContainText("Inga händelser ännu.");
});

test("diagnostics fit desktop, rail and touch phones with aligned rows and keyboard focus", async ({ browser }) => {
  const measurements: unknown[] = [];
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 950, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    const mobile = viewport.width < 651 || viewport.height < 501;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); await fixture(page); await seed(page, true); await signIn(page);
    await expect(page.locator(".project-error-summary")).toContainText("2 projektfel");
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await expect(historyButton(page)).toBeVisible();
      const button = (await historyButton(page).boundingBox())!;
      if (mobile) { expect(button.width).toBeGreaterThanOrEqual(44); expect(button.height).toBeGreaterThanOrEqual(44); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
      if (evidence) await page.screenshot({ path: `${evidence}/events-${viewport.width}x${viewport.height}-${theme}-header.png` });
      await historyButton(page).click();
      await expect(historyDialog(page).locator(".event-history-item")).toHaveCount(4);
      const geometry = await historyDialog(page).evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width); expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(viewport.width);
      const edges = await historyDialog(page).locator(".event-history-content").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left));
      const rowDrift = Math.max(...edges) - Math.min(...edges);
      expect(rowDrift).toBeLessThanOrEqual(1);
      const centers = await historyDialog(page).locator(".event-history-item").evaluateAll(elements => elements.map(element => {
        const icon = element.querySelector("svg")!.getBoundingClientRect();
        const meta = element.querySelector(".event-history-meta")!.getBoundingClientRect();
        return Math.abs(icon.top + icon.height / 2 - meta.top - meta.height / 2);
      }));
      expect(Math.max(...centers)).toBeLessThanOrEqual(1);
      measurements.push({ viewport, mobile, theme, historyButton: button, dialog: geometry, rowDrift, maxIconCenterDrift: Math.max(...centers), pageOverflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) });
      if (evidence) await page.screenshot({ path: `${evidence}/events-${viewport.width}x${viewport.height}-${theme}-dialog.png` });
      await closeHistory(page); await expect(historyButton(page)).toBeFocused();
    }
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/event-history-geometry.json`, JSON.stringify(measurements, null, 2));
});
