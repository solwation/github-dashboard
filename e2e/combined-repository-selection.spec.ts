import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import QRCode from "qrcode";
import { createHandoffUrl } from "../src/lib/handoff";
import { textAccessibility } from "./support/text-accessibility";

const token = "fictional-project-selection-token";
const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: false, description: "Fictional selection fixture", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
const labels = ["A long label that must keep its full tooltip while truncating", "accessibility", "keyboard navigation", "responsive layout", "documentation", "review", "additional context"];
async function fixture(page: Page) {
  const now = Date.now(), minute = 60000, day = 86400000;
  let version = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    if (url.pathname === "/user") return route.fulfill({ json: { login: "project-selection-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues")) {
      const issues = Array.from({ length: 8 }, (_, index) => {
        const number = index + 1, closed = number >= 6 || (version >= 2 && number === 1);
        return { id: repo!.id * 100 + number, number, title: number === 3 ? `A long ${repo!.name} title that stays readable before labels and wraps safely on narrow phones` : `${repo!.name} task ${number}`,
          body: "Fictional selection fixture.", comments: number === 3 ? 2 + version : 0,
          state: closed ? "closed" : "open", labels: number === 3 ? labels.map(name => ({ name, color: "aabbcc" })) : number === 4 || number === 5 || (version && number === 2) ? [{ name: "in-progress", color: "147d69" }] : [], assignees: [],
          created_at: new Date(now - 10 * day).toISOString(), updated_at: new Date(version ? now : now - day).toISOString(), closed_at: closed ? new Date(now - day).toISOString() : null,
          workStartedAt: closed ? new Date(now - day - 30 * minute).toISOString() : undefined, html_url: `${repo!.html_url}/issues/${number}` };
      });
      return route.fulfill({ json: issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) });
    }
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    if (event) return route.fulfill({ json: [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: new Date(now - (Number(event[1]) === 5 ? 40 : 10) * minute).toISOString() }] });
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Fixture camera unavailable", "NotAllowedError"); }; });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill(token);
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(16);
  return { refresh() { version++; } };
}
const sidebar = (page: Page, name: string) => page.locator(`.sidebar-repository-row[data-repository="sample/${name}"] .sidebar-repository`);
const entries = (page: Page, view: string, name?: string) => page.locator(`${view === "Kort" ? ".issue-card" : ".issue-row"}${name ? `[data-repository="sample/${name}"]` : ""}`);
async function frameColors(page: Page, view: string, name: string) {
  const dot = await sidebar(page, name).locator(".repo-dot").evaluate(element => getComputedStyle(element).backgroundColor);
  for (const entry of await entries(page, view, name).all()) {
    await expect(entry).toHaveClass(/repository-selected/);
    const values = await entry.evaluate(element => ({ frame: getComputedStyle(element, "::before").borderTopColor, width: getComputedStyle(element, "::before").borderTopWidth, chip: getComputedStyle(element.querySelector(".card-repository i, .row-repository i")!).backgroundColor }));
    expect(values.frame).toBe(dot); expect(values.chip).toBe(dot); expect(values.width).toBe("2px");
  }
  return dot;
}

test("selection survives pulse, refresh, filters, view switches and palette sync, and clears on toggle/removal/logout", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const api = await fixture(page);
  const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
  await split.uncheck();
  const alpha = sidebar(page, "alpha"), beta = sidebar(page, "beta");
  const before = await entries(page, "Kort").evaluateAll(items => items.map(item => ({ id: item.id, height: item.getBoundingClientRect().height })));
  await alpha.focus(); await page.keyboard.press("Enter");
  await expect(alpha).toHaveAttribute("aria-current", "true");
  await expect(alpha).toBeFocused();
  const first = entries(page, "Kort", "alpha").first();
  expect(await first.evaluate(element => getComputedStyle(element, "::before").animationName)).toBe("repository-selection-pulse");
  const color = await frameColors(page, "Kort", "alpha");
  await expect(first).not.toHaveClass(/repository-navigation-highlight/);
  await frameColors(page, "Kort", "alpha");
  expect(await entries(page, "Kort").evaluateAll(items => items.map(item => ({ id: item.id, height: item.getBoundingClientRect().height })))).toEqual(before);
  api.refresh(); await page.keyboard.press("Control+r");
  await expect(page.locator(".new-comments-badge")).toHaveCount(2);
  await expect(page.locator(".issue-card.unread-move")).toHaveCount(2);
  await frameColors(page, "Kort", "alpha");
  api.refresh(); await page.keyboard.press("Control+r");
  await expect(entries(page, "Kort", "alpha").filter({ hasText: "alpha task 1" })).toHaveClass(/just-closed/);
  await frameColors(page, "Kort", "alpha");
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await page.keyboard.press("Tab");
  await entries(page, "Lista", "alpha").first().locator(".row-title").focus();
  await expect(entries(page, "Lista", "alpha").first().locator(".row-title")).toHaveCSS("outline-style", "solid");
  await frameColors(page, "Lista", "alpha");
  const search = page.getByRole("textbox", { name: "Sök issues", exact: true });
  await search.fill("beta task"); await expect(entries(page, "Lista", "alpha")).toHaveCount(0);
  await expect(alpha).toHaveAttribute("aria-current", "true");
  await search.fill(""); await frameColors(page, "Lista", "alpha");
  // Modifier clicks retain normal link behavior and leave this document's selection intact.
  const prevented = await beta.evaluate(element => {
    let appPrevented = true;
    window.addEventListener("click", event => { appPrevented = event.defaultPrevented; event.preventDefault(); }, { once: true });
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
    return appPrevented;
  });
  expect(prevented).toBe(false); await expect(alpha).toHaveAttribute("aria-current", "true");
  // Same-account QR sync is the real palette update route; no reload or Vue internals.
  const url = createHandoffUrl(page.url(), { token, selected: repos.map(repo => repo.full_name), rules: {}, preferences: { splitByRepository: false, listMode: true, repositoryColors: { "sample/alpha": "#8b43b5", "sample/beta": "#987016" } } }).url;
  const image = await QRCode.toBuffer(url, { width: 640, margin: 4, errorCorrectionLevel: "L" });
  await page.getByRole("button", { name: "Öppna på mobilen", exact: true }).click();
  await page.getByRole("button", { name: "Skanna QR-kod från annan enhet", exact: true }).click();
  await page.getByLabel("Välj QR-bild", { exact: true }).setInputFiles({ name: "fictional-palette.png", mimeType: "image/png", buffer: image });
  await expect(page.getByRole("dialog", { name: "Läs QR-kod", exact: true })).toHaveCount(0);
  await expect(alpha.locator(".repo-dot")).toHaveCSS("background-color", "rgb(139, 67, 181)");
  await expect(entries(page, "Lista")).toHaveCount(14);
  await page.locator(".combined-board .closed").getByRole("button", { name: "Visa fler", exact: true }).click();
  await expect(entries(page, "Lista")).toHaveCount(16);
  await expect(alpha).toHaveAttribute("aria-current", "true");
  expect(await frameColors(page, "Lista", "alpha")).not.toBe(color);
  await page.emulateMedia({ colorScheme: "dark" }); await frameColors(page, "Lista", "alpha");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await beta.click(); await expect(beta).toHaveAttribute("aria-current", "true"); await expect(alpha).not.toHaveAttribute("aria-current");
  await frameColors(page, "Lista", "beta");
  expect(await entries(page, "Lista", "beta").first().evaluate(element => getComputedStyle(element, "::before").animationName)).toBe("none");
  await beta.press("Enter"); await expect(page.locator(".repository-selected")).toHaveCount(0);
  await alpha.click();
  await page.locator(".sidebar-add").click();
  await page.getByRole("dialog").getByRole("checkbox", { name: "sample/alpha" }).uncheck();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repository-selected")).toHaveCount(0);
  await beta.click(); await expect(beta).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill(token);
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(entries(page, "Lista")).toHaveCount(8);
  await expect(page.locator(".repository-selected")).toHaveCount(0);
  await writeFile(info.outputPath("state-result.json"), JSON.stringify({ initialColor: color, refresh: true, paletteSync: true, closingFeedback: true, filters: true, removal: true, logout: true }));
});

const sizes = [
  { width: 1600, height: 1000, mobile: false }, { width: 1000, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true }, { width: 844, height: 390, mobile: true }, { width: 320, height: 568, mobile: true },
];
for (const size of sizes) for (const theme of ["light", "dark"] as const) {
  test(`selected project frame matrix ${size.width}x${size.height} ${theme}`, async ({ browser }, info) => {
    // The sidebar is absent on phones; establish selection using its existing desktop route first.
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, isMobile: size.mobile, hasTouch: size.mobile, locale: "sv-SE", colorScheme: theme, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const api = await fixture(page);
    api.refresh(); await page.keyboard.press("Control+r");
    await expect(page.locator(".issue-card.unread-move")).toHaveCount(2);
    const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
    await split.uncheck(); await sidebar(page, "alpha").click();
    await expect(entries(page, "Kort", "alpha").first()).not.toHaveClass(/repository-navigation-highlight/);
    await page.setViewportSize({ width: size.width, height: size.height });
    for (const splitMode of [false, true]) {
      if (splitMode) await split.check();
      for (const view of ["Kort", "Lista"]) {
        await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: view, exact: true }).click();
        await expect(entries(page, view)).toHaveCount(16);
        if (splitMode) await expect(page.locator(".repository-selected")).toHaveCount(0);
        else {
          await frameColors(page, view, "alpha");
          if (view === "Kort") await textAccessibility(page);
          await expect(page.locator('.combined-board .repository-selected[data-repository="sample/beta"]')).toHaveCount(0);
          await expect(sidebar(page, "alpha")).toHaveAttribute("aria-current", "true");
        }
        const geometry = await entries(page, view).evaluateAll(items => items.map(item => {
          const rect = item.getBoundingClientRect();
          const title = item.querySelector(".issue-title, .row-title")!.getBoundingClientRect();
          return { repository: item.getAttribute("data-repository"), height: rect.height, titleInset: title.left - rect.left, overflow: item.scrollWidth - item.clientWidth, border: getComputedStyle(item).borderColor, shadow: getComputedStyle(item).boxShadow };
        }));
        expect(geometry.every(item => item.overflow <= 1)).toBe(true);
        if (view === "Lista") expect(Math.max(...geometry.map(item => item.height))).toBeLessThanOrEqual(100);
        if (view === "Kort" && size.width === 1600) expect((await entries(page, view, "alpha").filter({ has: page.getByRole("link", { name: "alpha task 1", exact: true }) }).boundingBox())!.height).toBeLessThanOrEqual(100);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        await writeFile(info.outputPath(`${splitMode ? "split" : "combined"}-${view}-geometry.json`), JSON.stringify(geometry, null, 2));
        const timeout = entries(page, view, "alpha").filter({ hasText: "alpha task 5" });
        await expect(timeout).toHaveClass(/issue-timeout/);
        await timeout.screenshot({ path: info.outputPath(`${splitMode ? "split" : "combined"}-${view}-timeout.png`) });
        await entries(page, view).first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: info.outputPath(`${splitMode ? "split" : "combined"}-${view}.png`) });
      }
    }
    await split.uncheck(); await expect(entries(page, "Lista", "alpha").first()).toHaveClass(/repository-selected/);
    expect(errors).toEqual([]);
    await context.close();
  });
}
