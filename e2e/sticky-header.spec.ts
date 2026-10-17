import { expect, test, type Page } from "@playwright/test";

const shots = process.env.STICKY_SCREENSHOT_DIR;

async function openDemo(page: Page, width: number) {
  await page.setViewportSize({ width, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
}

async function expectHeaderPinned(page: Page) {
  const brand = (await page.locator(".sidebar").boundingBox())!;
  const bar = (await page.locator(".topbar").boundingBox())!;
  expect(Math.abs(brand.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(bar.y - (brand.y + brand.height))).toBeLessThanOrEqual(1);
  await expect(page.locator(".topbar").getByRole("button", { name: "Inställningar", exact: true })).toBeInViewport();
  await expect(page.locator(".sidebar .brand")).toBeInViewport();
  return bar.y + bar.height;
}

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("phone header rows stay pinned while scrolling overview and statistics", async ({ page }) => {
  await openDemo(page, 390);
  // At the start the header sits above the content instead of covering it.
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

  // Dialogs still open above the header.
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("phone header stays pinned in dark theme without sideways scrolling at 320 px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("issueflow-theme", "dark"));
  await openDemo(page, 320);
  expect(await noSideScroll(page)).toBe(true);
  await page.evaluate(() => scrollTo(0, 1500));
  const bottom = await expectHeaderPinned(page);
  // Both rows together stay a reasonable part of a small screen.
  expect(bottom).toBeLessThanOrEqual(200);
  expect(await noSideScroll(page)).toBe(true);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => scrollTo(0, 1500));
  await expectHeaderPinned(page);
  if (shots) await page.screenshot({ path: `${shots}/sticky-390-dark.png` });
});

test("desktop header keeps its normal flow", async ({ page }) => {
  await openDemo(page, 1280);
  await expect(page.locator(".topbar")).toHaveCSS("position", "static");
  await page.evaluate(() => scrollTo(0, 800));
  expect((await page.locator(".topbar").boundingBox())!.y).toBeLessThan(0);
});
