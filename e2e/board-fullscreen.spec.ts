import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { setBoardGrouping, type BoardGrouping } from "./support/board-grouping";

// #468: a board full-screen mode that leaves only the toolbar and the board.
const shotsDir = process.env.SHOTS_DIR;
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".board-toolbar")).toBeVisible();
}
const toolbar = (page: Page) => page.locator(".board-toolbar");
const enterButton = (page: Page) => toolbar(page).getByRole("button", { name: "Helskärm", exact: true });
const exitButton = (page: Page) => toolbar(page).getByRole("button", { name: "Stäng helskärm", exact: true });
const handle = (page: Page) => toolbar(page).locator(".board-fullscreen-handle");

async function expectFullscreen(page: Page, on: boolean) {
  const state = on ? "toBeHidden" : "toBeVisible";
  await expect(page.locator("header.topbar"))[state]();
  await expect(page.locator(".page-heading"))[state]();
  await expect(page.getByRole("region", { name: "Sammanfattning" }))[state]();
  await expect(handle(page)).toHaveCount(on ? 1 : 0);
  await expect(on ? exitButton(page) : enterButton(page)).toBeVisible();
}

test("desktop: enter, open and close the sidebar handle, exit with X and Escape, keyboard focus kept", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDemo(page);
  // The button sits directly to the right of the Cards | List switch.
  expect(await toolbar(page).locator(".board-mode-toggle + .board-fullscreen-toggle").count()).toBe(1);
  await expect(enterButton(page)).toHaveAttribute("title", "Helskärm");
  await toolbar(page).getByRole("button", { name: "Lista", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(enterButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expectFullscreen(page, true);
  await expect(page.locator("aside.sidebar")).toBeHidden();
  await expect(exitButton(page)).toBeFocused();
  await expect(exitButton(page)).toHaveAttribute("title", "Stäng helskärm");
  // The exit X is the toolbar's top-right control.
  const exitBox = (await exitButton(page).boundingBox())!, searchBox = (await page.locator("#issue-search").boundingBox())!;
  expect(exitBox.x + exitBox.width).toBeGreaterThan(1280 - 40);
  expect(Math.abs(exitBox.y + exitBox.height / 2 - (searchBox.y + searchBox.height / 2))).toBeLessThanOrEqual(2);
  expect(await noPageScroll(page)).toBe(true);

  // The edge handle is reachable with the keyboard before the search field.
  await page.locator("#issue-search input").focus();
  await page.keyboard.press("Shift+Tab");
  const opener = page.getByRole("button", { name: "Öppna vänstermeny", exact: true });
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(opener).toHaveAttribute("aria-controls", "app-sidebar");
  expect((await opener.boundingBox())!.x).toBeLessThanOrEqual(1);
  await page.keyboard.press("Enter");
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toBeVisible();
  await expect(page.locator(".sidebar-backdrop")).toBeVisible();
  const hide = page.getByRole("button", { name: "Dölj vänstermeny", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => page.evaluate(() => document.querySelector("aside.sidebar")!.contains(document.activeElement))).toBe(true);
  // The handle follows the overlay's right edge so it can hide it again.
  await page.waitForTimeout(350);
  const sidebarBox = (await sidebar.boundingBox())!;
  expect(Math.abs((await hide.boundingBox())!.x - (sidebarBox.x + sidebarBox.width))).toBeLessThanOrEqual(1);
  // Escape closes only the overlay and returns focus to the handle.
  await page.keyboard.press("Escape");
  await expect(sidebar).toBeHidden();
  await expect(opener).toBeFocused();
  await expectFullscreen(page, true);
  // Pointer: the handle toggles, and the backdrop closes the overlay too.
  await opener.click();
  await expect(sidebar).toBeVisible();
  await hide.click();
  await expect(sidebar).toBeHidden();
  await opener.click();
  await page.locator(".sidebar-backdrop").click({ position: { x: 1000, y: 400 } });
  await expect(sidebar).toBeHidden();

  // Escape leaves full screen when no dialog is open; focus stays on the toolbar button.
  await exitButton(page).focus();
  await page.keyboard.press("Escape");
  await expectFullscreen(page, false);
  await expect(page.locator("aside.sidebar")).toBeVisible();
  await expect(enterButton(page)).toBeFocused();
  // The X exits too.
  await enterButton(page).click();
  await expectFullscreen(page, true);
  await exitButton(page).click();
  await expectFullscreen(page, false);
  await expect(enterButton(page)).toBeFocused();
  // Leaving full screen keeps the toolbar visible below the returning sticky top bar.
  const topbarBottom = (await page.locator("header.topbar").boundingBox())!;
  expect((await page.locator("#issue-search").boundingBox())!.y).toBeGreaterThanOrEqual(topbarBottom.y + topbarBottom.height);
});

test("Escape inside an open dialog does not leave full screen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDemo(page);
  await enterButton(page).click();
  await page.locator(".issue-card a, .issue-card button").first().focus();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "probe-dialog";
    dialog.innerHTML = "<button>probe</button>";
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.keyboard.press("Escape");
  await expect(page.locator("#probe-dialog")).toBeHidden();
  await expectFullscreen(page, true);
});

for (const list of [false, true]) {
  test(`full screen works in ${list ? "List" : "Cards"} for Joined, Split and Swimlanes at 1000x900`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await openDemo(page);
    await toolbar(page).getByRole("button", { name: list ? "Lista" : "Kort", exact: true }).click();
    await enterButton(page).click();
    for (const grouping of ["none", "split", "swimlanes"] as BoardGrouping[]) {
      await setBoardGrouping(page, grouping);
      await expectFullscreen(page, true);
      await expect(page.locator(list ? ".issue-row" : ".issue-card").first()).toBeVisible();
      expect(await noPageScroll(page), grouping).toBe(true);
      // The handle stays inside main's side padding, left of the content edge the search shares with the board.
      const handleBox = (await handle(page).boundingBox())!;
      const content = (await page.locator("#issue-search").boundingBox())!;
      expect(handleBox.x + handleBox.width, grouping).toBeLessThanOrEqual(content.x + 1);
    }
  });
}

for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`phone ${size.width}x${size.height}: handle and exit X share the search row, drawer opens and closes`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await openDemo(page);
    // Normal phone layout: the full-screen button ends the search row instead of wrapping alone.
    const normalSearch = (await page.locator("#issue-search").boundingBox())!, enterBox = (await enterButton(page).boundingBox())!;
    expect(Math.abs(enterBox.y + enterBox.height / 2 - (normalSearch.y + normalSearch.height / 2))).toBeLessThanOrEqual(4);
    expect(enterBox.x + enterBox.width).toBeLessThanOrEqual(size.width);
    await enterButton(page).tap();
    await expectFullscreen(page, true);
    const search = (await page.locator("#issue-search").boundingBox())!;
    const handleBox = (await handle(page).boundingBox())!, exitBox = (await exitButton(page).boundingBox())!;
    for (const box of [handleBox, exitBox]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(box.y + box.height / 2 - (search.y + search.height / 2))).toBeLessThanOrEqual(4);
    }
    expect(handleBox.x).toBeLessThan(search.x);
    expect(exitBox.x).toBeGreaterThan(search.x + search.width);
    expect(exitBox.x + exitBox.width).toBeLessThanOrEqual(size.width);
    expect(await noPageScroll(page)).toBe(true);
    await toolbar(page).getByRole("button", { name: "Lista", exact: true }).tap();
    expect(await noPageScroll(page)).toBe(true);

    await handle(page).tap();
    const drawer = page.locator("aside.sidebar.sidebar-mobile-open");
    await expect(drawer).toBeVisible();
    await page.locator(".sidebar-mobile-close").tap();
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await expect(handle(page)).toHaveAttribute("aria-expanded", "false");
    await exitButton(page).tap();
    await expectFullscreen(page, false);
    await context.close();
  });
}

// Screenshot matrix for review (#468): SHOTS_DIR=... npx playwright test e2e/board-fullscreen.spec.ts -g matrix
const matrix = [
  { name: "1600x1000", viewport: { width: 1600, height: 1000 }, mobile: false },
  { name: "1000x900", viewport: { width: 1000, height: 900 }, mobile: false },
  { name: "390x844", viewport: { width: 390, height: 844 }, mobile: true },
  { name: "844x390", viewport: { width: 844, height: 390 }, mobile: true },
];
for (const scenario of matrix) {
  test(`matrix screenshots ${scenario.name}`, async ({ browser }) => {
    test.skip(!shotsDir, "SHOTS_DIR not set");
    mkdirSync(shotsDir!, { recursive: true });
    const context = await browser.newContext({ viewport: scenario.viewport, isMobile: scenario.mobile, hasTouch: scenario.mobile, locale: "sv-SE" });
    const page = await context.newPage();
    await openDemo(page);
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const mode of ["Kort", "Lista"]) {
        await toolbar(page).getByRole("button", { name: mode, exact: true }).click();
        const view = mode === "Kort" ? "cards" : "list";
        await page.screenshot({ path: `${shotsDir}/${scenario.name}-${view}-${theme}-normal.png` });
        await enterButton(page).click();
        await page.waitForTimeout(300);
        expect(await noPageScroll(page)).toBe(true);
        await page.screenshot({ path: `${shotsDir}/${scenario.name}-${view}-${theme}-fullscreen.png` });
        if (mode === "Kort") {
          await handle(page).click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${shotsDir}/${scenario.name}-${view}-${theme}-fullscreen-sidebar.png` });
          await page.keyboard.press("Escape");
          if (await handle(page).getAttribute("aria-expanded") === "true") await handle(page).click({ force: true });
        }
        await exitButton(page).click();
      }
    }
    await context.close();
  });
}
