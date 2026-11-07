import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { readSettings } from "./support/settings";
import { boardSplit } from "./support/board-grouping";
const evidence = process.env.EVENT_HISTORY_EVIDENCE;
const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: true, description: "Synthetic diagnostics fixture", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
async function fixture(page: Page) {
  const failures = new Set(["alpha", "beta"]);
  let login = "history-account";
  let status: string | null = null;
  let dropped = false, droppedRequests = 0;
  let verificationGate: Promise<void> | undefined; let releaseVerification: (() => void) | undefined;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (dropped && url.pathname.startsWith("/repos/")) { droppedRequests++; return route.abort("internetdisconnected"); }
    if (url.pathname === "/repos/sample/alpha/issues/1" && status === "pending-close") {
      await verificationGate;
      const at = new Date().toISOString();
      return route.fulfill({ json: { id: 1, number: 1, title: "Moving fixture", body: "Synthetic event", comments: 0, state: "closed", created_at: "2026-11-01T00:00:00Z", updated_at: at, closed_at: at, labels: [], assignees: [], html_url: "https://github.com/sample/alpha/issues/1" } });
    }
    if (url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      if (failures.has(repo.name)) return route.fulfill({ status: 500, json: { message: `Synthetic ${repo.name} failure: ` + "Long diagnostic context ".repeat(12) } });
      if (status && repo.name === "alpha") {
        const closed = status === "closed", at = new Date().toISOString();
        return route.fulfill({ json: status !== "pending-close" && url.searchParams.get("state") === (closed ? "closed" : "open") ? [{ id: 1, number: 1, title: "Moving fixture", body: "Synthetic event", comments: 0, state: closed ? "closed" : "open", created_at: "2026-11-01T00:00:00Z", updated_at: at, closed_at: closed ? at : null, labels: status === "progress" ? [{ name: "in-progress", color: "fff" }] : [], assignees: [], html_url: "https://github.com/sample/alpha/issues/1" }] : [] });
      }
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  return { failures, holdVerification() { verificationGate = new Promise<void>(resolve => { releaseVerification = resolve; }); return () => releaseVerification?.(); }, status(value: string) { status = value; failures.clear(); }, account(value: string) { login = value; },
    drop(value: boolean) { dropped = value; droppedRequests = 0; }, dropped: () => droppedRequests };
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
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveCount(0); // Foreground recovery stays in history without notifying.
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
      await page.evaluate(async theme => { const path = "/src/lib/theme.ts"; (await import(path)).setTheme(theme); }, theme);
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
        const meta = element.querySelector(".event-history-meta strong")!.getBoundingClientRect();
        return Math.abs(icon.top + icon.height / 2 - meta.top - meta.height / 2);
      }));
      expect(Math.max(...centers)).toBeLessThanOrEqual(1);
      const rows = await historyDialog(page).locator(".event-history-item").evaluateAll(elements => elements.map(element => {
        const message = element.querySelector("p")!, repository = element.querySelector(".event-history-repository"), time = element.querySelector("time")!;
        return { height: element.getBoundingClientRect().height, message: message.textContent, messageFontSize: getComputedStyle(message).fontSize, repository: repository?.textContent, time: time.textContent, datetime: time.getAttribute("datetime"), overflow: element.scrollWidth - element.clientWidth };
      }));
      expect(rows.every(row => row.message && row.time && row.datetime && row.overflow <= 0 && row.messageFontSize === "13px")).toBe(true);
      measurements.push({ viewport, mobile, theme, historyButton: button, dialog: geometry, rows, rowDrift, maxIconCenterDrift: Math.max(...centers), pageOverflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) });
      if (evidence) await page.screenshot({ path: `${evidence}/events-${viewport.width}x${viewport.height}-${theme}-dialog.png` });
      await closeHistory(page); await expect(historyButton(page)).toBeFocused();
    }
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/event-history-geometry.json`, JSON.stringify(measurements, null, 2));
});

test("state changes stay in history while only background info increments the green badge", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const api = await fixture(page); api.status("backlog"); await seed(page);
  await page.evaluate(() => { (window as any).eventsForeground = true; Object.defineProperty(document, "hasFocus", { value: () => (window as any).eventsForeground }); });
  await signIn(page); await expect(page.locator(".issue-title")).toHaveText("Moving fixture");
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveCount(0);
  api.status("progress"); await page.keyboard.press("Control+r");
  await expect.poll(() => readSettings(page, "history-account").then(saved => saved?.eventHistory?.entries.length)).toBe(1);
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveCount(0);
  await historyButton(page).click(); await expect(historyDialog(page).locator(".event-history-item")).toContainText("Backlog → Pågående"); await closeHistory(page);
  await page.evaluate(() => { (window as any).eventsForeground = false; });
  const release = api.holdVerification(); api.status("pending-close"); await page.keyboard.press("Control+r");
  await expect(page.locator(".issue-card.pending-closure")).toHaveCount(1);
  await expect(historyButton(page).locator(".event-unseen-badge")).toHaveCount(0); // Unverified closing is not an event.
  release();
  const badge = historyButton(page).locator(".event-unseen-badge"); await expect(badge).toHaveText("1"); await expect(badge).toHaveAttribute("data-severity", "info");
  await page.evaluate(() => { (window as any).eventsForeground = true; });
  await page.keyboard.press("Control+r"); await expect(badge).toHaveText("1"); // Return/unchanged poll does not clear or duplicate.
  await page.screenshot({ path: testInfo.outputPath("green-background-info.png") });
  api.failures.add("beta"); await page.keyboard.press("Control+r");
  await expect(badge).toHaveText("2"); await expect(badge).toHaveAttribute("data-severity", "error");
  await historyButton(page).click(); await expect(historyDialog(page).locator(".event-history-item")).toHaveCount(3); await expect(historyDialog(page).locator(".event-history-item").filter({ hasText: "Pågående → Stängda" })).toHaveCount(1); await closeHistory(page);
  await expect(badge).toHaveCount(0);
});

test("unseen warnings use an orange badge in both themes and disappear when read", async ({ page }, testInfo) => {
 await page.emulateMedia({ reducedMotion: "reduce" });
 const api = await fixture(page); api.failures.clear(); await seed(page, true); await signIn(page);
 const badge = historyButton(page).locator(".event-unseen-badge"); await expect(badge).toHaveText("2"); await expect(badge).toHaveAttribute("data-severity", "warning");
 for (const theme of ["light", "dark"]) {
  await page.evaluate(async theme => { const path = "/src/lib/theme.ts"; (await import(path)).setTheme(theme); }, theme);
  await expect(badge).toHaveCSS("background-color", theme === "light" ? "rgb(148, 96, 0)" : "rgb(224, 183, 101)");
  await expect(page.locator(".stat").first()).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 33, 36)" : "rgb(255, 255, 255)");
  await page.screenshot({ path: testInfo.outputPath(`orange-warning-${theme}.png`) });
 }
 await historyButton(page).click(); await expect(historyDialog(page).locator(".event-history-item")).toHaveCount(2); await closeHistory(page); await expect(badge).toHaveCount(0);
});

/** Emulates iOS hiding the page; the sync scheduler wakes on each visibility change. */
async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate(value => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => value });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => value === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}
test("connections dropped while hidden log nothing; foreground failures do and recover as one event (#434)", async ({ page }) => {
  test.setTimeout(60_000);
  const api = await fixture(page); api.failures.clear(); await seed(page); await signIn(page);
  const summary = page.locator(".project-error-summary");
  await expect(page.locator(".repo-lane").first()).toBeVisible();
  await expect.poll(() => readSettings(page, "history-account").then(saved => saved?.eventHistory !== undefined)).toBe(true);
  api.drop(true);
  await setVisibility(page, "hidden");
  await expect.poll(api.dropped).toBeGreaterThanOrEqual(2);
  api.drop(false);
  await setVisibility(page, "visible");
  await page.waitForTimeout(500);
  await expect(summary).toHaveCount(0);
  await expect.poll(() => readSettings(page, "history-account").then(saved => saved?.eventHistory?.entries.length ?? 0)).toBe(0);
  api.drop(true);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(summary).toContainText("2 projektfel"); // A foreground network failure is still reported.
  api.drop(false);
  await expect(summary).toHaveCount(0, { timeout: 30_000 }); // Both repositories retry together after their backoff.
  await historyButton(page).click();
  const recoveries = historyDialog(page).locator(".event-history-item[data-severity='info']");
  await expect(recoveries).toHaveCount(1);
  await expect(recoveries).toContainText("Synkroniseringen fungerar igen för 2 projekt.");
  await expect(recoveries.locator(".event-history-repository")).toHaveText("sample/alpha, sample/beta");
  if (evidence) await page.screenshot({ path: `${evidence}/events-combined-recovery.png` });
});
