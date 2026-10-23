import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

const shots = process.env.STICKY_SCREENSHOT_DIR;

async function openDemo(page: Page, width: number) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
}

async function expectHeaderPinned(page: Page) {
  const bar = (await page.locator(".topbar").boundingBox())!;
  expect(Math.abs(bar.y)).toBeLessThanOrEqual(1);
  expect(bar.height).toBeLessThanOrEqual(80);
  await expect(page.locator(".topbar .breadcrumb strong")).toBeInViewport();
  await expect(page.locator(".mobile-navigation")).toBeInViewport();
  await expect(page.locator(".mobile-menu-button")).toBeInViewport();
  await expect(page.locator(".sidebar")).toBeHidden();
  return bar.y + bar.height;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("phone header rows stay pinned while scrolling overview and statistics", async ({ page }) => {
  await openDemo(page, 390);
  // A single compact navigation row sits above content instead of covering it.
  const headerBottom = await expectHeaderPinned(page);
  expect((await page.locator("main").boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom - 1);

  await page.evaluate(() => scrollTo(0, 1500));
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
  const pinnedBottom = await expectHeaderPinned(page);
  // The header has a solid background that hides the content scrolling beneath it.
  const background = await page.locator(".topbar").evaluate(el => getComputedStyle(el).backgroundColor);
  expect(background).not.toMatch(/rgba\(.*, 0\)|transparent/);
  if (shots) await page.screenshot({ path: `${shots}/sticky-390.png` });

  // An anchor jump to a repository keeps its heading clear of the sticky header.
  const lastId = await page.locator(".repo-lane").last().getAttribute("id");
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(id => { location.hash = `#${id}`; }, lastId);
  await expect.poll(async () => (await page.locator(`#${lastId}`).boundingBox())!.y).toBeGreaterThanOrEqual(pinnedBottom);
  await expect(page.locator(`#${lastId} .lane-header`)).toBeInViewport();
  await expectHeaderPinned(page);
  expect(await noSideScroll(page)).toBe(true);

  await page.getByRole("link", { name: "Statistik", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expectHeaderPinned(page);

  // Secondary actions stay easy to reach in the menu and dialogs open above it.
  await page.getByRole("button", { name: "Meny" }).click();
  await expect(page.locator(".topbar-right").getByRole("button", { name: "Inställningar", exact: true })).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("phone header stays pinned in dark theme without sideways scrolling at 320 px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("issueflow-theme", "dark"));
  await openDemo(page, 320);
  expect(await noSideScroll(page)).toBe(true);
  await page.evaluate(() => scrollTo(0, 1500));
  const bottom = await expectHeaderPinned(page);
  expect(bottom).toBeLessThanOrEqual(80);
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => scrollTo(0, 1500));
  await expectHeaderPinned(page);
  if (shots) await page.screenshot({ path: `${shots}/sticky-390-dark.png` });
});

/** Wider layouts (#153): the topbar pins at the top of the workspace column beside the fixed sidebar. */
async function expectTopbarPinned(page: Page) {
  const sidebar = (await page.locator(".sidebar").boundingBox())!;
  const bar = (await page.locator(".topbar").boundingBox())!;
  expect(Math.abs(bar.y)).toBeLessThanOrEqual(1);
  // It sits beside the sidebar instead of covering it, and spans the rest of the viewport.
  expect(bar.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width - 1);
  expect(Math.abs(bar.x + bar.width - await page.evaluate(() => innerWidth))).toBeLessThanOrEqual(1);
  await expect(page.locator(".topbar").getByRole("button", { name: "Inställningar", exact: true })).toBeInViewport();
  await expect(page.locator(".topbar .breadcrumb")).toBeInViewport();
  const style = await page.locator(".topbar").evaluate(el => {
    const css = getComputedStyle(el);
    return { background: css.backgroundColor, border: css.borderBottomStyle, borderWidth: css.borderBottomWidth };
  });
  expect(style.background).not.toMatch(/rgba\(.*, 0\)|transparent/);
  expect(style).toMatchObject({ border: "solid", borderWidth: "1px" });
  return bar.y + bar.height;
}

for (const [width, theme] of [[768, "light"], [1280, "dark"], [1440, "light"]] as const) {
  test(`header stays pinned on ${width} px in ${theme} theme in overview and statistics`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem("issueflow-theme", value), theme);
    await openDemo(page, width);
    const start = await expectTopbarPinned(page);
    expect((await page.locator("main").boundingBox())!.y).toBeGreaterThanOrEqual(start - 1);

    await page.evaluate(() => scrollTo(0, 1500));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
    const pinnedBottom = await expectTopbarPinned(page);
    if (shots) await page.screenshot({ path: `${shots}/sticky-${width}-${theme}.png` });

    // Anchor jumps land below the pinned header.
    const lastId = await page.locator(".repo-lane").last().getAttribute("id");
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(id => { location.hash = `#${id}`; }, lastId);
    await expect.poll(async () => (await page.locator(`#${lastId}`).boundingBox())!.y).toBeGreaterThanOrEqual(pinnedBottom);
    await expect(page.locator(`#${lastId} .lane-header`)).toBeInViewport();
    await expectTopbarPinned(page);
    expect(await noSideScroll(page)).toBe(true);

    await page.getByRole("link", { name: "Statistik", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Statistik", exact: true })).toBeVisible();
    await expect(page.locator(".topbar .breadcrumb strong")).toHaveText("Statistik");
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300);
    await expectTopbarPinned(page);
    // A Statistics project anchor also keeps its heading clear of the header.
    const statisticsId = await page.locator(".statistics-repository").last().getAttribute("id");
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(id => { location.hash = `#${id}`; }, statisticsId);
    await expect.poll(async () => (await page.locator(`#${statisticsId}`).boundingBox())!.y).toBeGreaterThanOrEqual(pinnedBottom);
    await expect(page.locator(`#${statisticsId} h2`)).toBeInViewport();
    await expectTopbarPinned(page);

    // Dialogs still open above the header.
    await page.locator(".topbar").getByRole("button", { name: "Inställningar", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading").first()).toBeInViewport();
  });
}
