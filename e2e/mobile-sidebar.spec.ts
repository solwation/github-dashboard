import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// #382: the open phone drawer is a compact vertical column with the desktop sidebar's functions.
const shotsDir = process.env.SHOTS_DIR;
const tag = process.env.SHOT_TAG ?? "after";
async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: `${shotsDir}/${name}.png` });
}
async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
}
async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator("#repo-1")).toBeVisible();
}
const sizes = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 320, height: 568 },
];
for (const size of sizes) {
  test(`phone drawer is a vertical column with every sidebar function at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await openDemo(page);
    await page.getByRole("button", { name: "Öppna vänstermeny" }).tap();
    const panel = page.locator("aside.sidebar.sidebar-mobile-open");
    await expect(panel).toBeVisible();
    await page.waitForTimeout(400);
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.x).toBeGreaterThanOrEqual(-1);
    const inside = async (locator: Locator, label: string) => {
      await locator.scrollIntoViewIfNeeded();
      const box = (await locator.boundingBox())!;
      expect(box, label).not.toBeNull();
      expect(box.x, `${label} left`).toBeGreaterThanOrEqual(panelBox.x - 1);
      expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
      // y is relative to the scrolled content, so comparisons stay valid after scrolling.
      return { x: box.x, width: box.width, height: box.height, y: box.y + (await panel.evaluate(node => node.scrollTop)) };
    };
    const brand = await inside(panel.locator("a.brand"), "brand");
    const close = (await panel.locator(".sidebar-mobile-close").boundingBox())!;
    expect(brand.x + brand.width, "brand clears the close button").toBeLessThanOrEqual(close.x + 1);
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    const overview = await inside(panel.getByRole("link", { name: "Översikt" }), "Översikt");
    const statistics = await inside(panel.getByRole("link", { name: "Statistik" }), "Statistik");
    expect(statistics.y, "Statistik is below Översikt").toBeGreaterThan(overview.y + overview.height - 1);
    expect(Math.abs(statistics.x - overview.x), "navigation items share a left edge").toBeLessThanOrEqual(1);
    await expect(panel.locator(".nav-count")).toBeVisible();
    await expect(panel.getByText("WORKSPACE", { exact: true })).toBeVisible();
    await expect(panel.getByText("REPOSITORIES", { exact: true })).toBeVisible();
    // The add button only exists for signed-in/public sessions; the demo has none.
    const add = panel.getByRole("button", { name: "Välj repositories" });
    if (await add.count()) expect((await inside(add, "add")).height).toBeGreaterThanOrEqual(44);
    const rows = panel.locator(".sidebar-repository");
    expect(await rows.count()).toBeGreaterThan(1);
    let previousBottom = -Infinity;
    for (let index = 0; index < await rows.count(); index++) {
      const row = rows.nth(index);
      const box = await inside(row, `repository ${index}`);
      expect(box.height, `repository ${index} touch height`).toBeGreaterThanOrEqual(44);
      expect(box.y, `repository ${index} stacks vertically`).toBeGreaterThanOrEqual(previousBottom - 1);
      previousBottom = box.y + box.height;
      await expect(row.locator(".project-icon")).toBeVisible();
      await expect(row.locator(".repository-counts, .repo-slots").first()).toBeVisible();
      const label = row.locator(".repository-label");
      expect(await label.evaluate(node => getComputedStyle(node).textOverflow)).toBe("ellipsis");
    }
    // Icon slots share left/right edges across rows (+-1px).
    for (const selector of [".repo-github", ".repo-board-toggle", ".project-icon"]) {
      const edges = await panel.locator(selector).evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return [box.left, box.right]; }));
      expect(edges.length, selector).toBeGreaterThan(1);
      for (const [l, r] of edges) {
        expect(Math.abs(l - edges[0][0]), `${selector} left edge`).toBeLessThanOrEqual(1);
        expect(Math.abs(r - edges[0][1]), `${selector} right edge`).toBeLessThanOrEqual(1);
      }
    }
    await inside(panel.locator(".repo-github").first(), "GitHub link");
    const toggle = panel.locator(".sidebar-inactive-toggle");
    if (await toggle.count()) expect((await inside(toggle, "hide inactive")).height).toBeGreaterThanOrEqual(44);
    const versionLocator = panel.locator(".sidebar-version");
    const version = await inside(versionLocator, "version");
    await expect(versionLocator.locator(".sidebar-version-caption")).toBeVisible();
    await expect(versionLocator.locator(".sidebar-version-build")).toBeVisible();
    const footer = await inside(panel.locator(".sidebar-footer"), "footer");
    expect(version.height).toBeGreaterThanOrEqual(44);
    expect(footer.height).toBeGreaterThanOrEqual(44);
    expect(footer.y, "footer after version").toBeGreaterThanOrEqual(version.y + version.height - 1);
    // Left edges of the section captions, nav icons and repository dots line up (+-1px).
    await panel.evaluate(node => { node.scrollTop = 0; });
    const left = (locator: Locator) => locator.first().evaluate(node => node.getBoundingClientRect().left + parseFloat(getComputedStyle(node).paddingLeft));
    const edge = await left(panel.getByText("WORKSPACE", { exact: true }));
    expect(Math.abs(await left(panel.getByText("REPOSITORIES", { exact: true })) - edge), "captions share a left edge").toBeLessThanOrEqual(1);
    expect(Math.abs(await left(panel.locator(".nav-item > svg")) - edge), "nav icon aligns with captions").toBeLessThanOrEqual(1);
    expect(Math.abs(await left(panel.locator(".sidebar-repository .project-icon")) - edge), "repository dot aligns with captions").toBeLessThanOrEqual(1);
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await panel.evaluate(node => { node.scrollTop = 0; });
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      await panel.evaluate(node => { node.scrollTop = 0; });
      await shot(page, `drawer-${size.width}x${size.height}-${theme}-top`);
      await panel.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await shot(page, `drawer-${size.width}x${size.height}-${theme}-bottom`);
    }
    // #379 behaviour survives: Escape closes, reopening works and navigation closes the drawer.
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await page.getByRole("button", { name: "Öppna vänstermeny" }).tap();
    await page.locator("aside.sidebar.sidebar-mobile-open").getByRole("link", { name: "Översikt" }).tap();
    await expect(page.locator("aside.sidebar.sidebar-mobile-open")).toHaveCount(0);
    // #384: once slid out, the closed drawer leaves the tab order and accessibility tree.
    await expect(page.locator("aside.sidebar")).toBeHidden();
    await expect(page.locator("aside.sidebar").getByRole("link")).toHaveCount(0);
    await context.close();
  });
}

for (const size of [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }, { width: 800, height: 900 }]) {
  test(`desktop sidebar geometry at ${size.width}x${size.height} is unchanged`, async ({ page }) => {
    await page.setViewportSize(size);
    await openDemo(page);
    const sidebar = page.locator("aside.sidebar");
    const box = (await sidebar.boundingBox())!;
    expect(box.x).toBe(0);
    expect(Math.round(box.width)).toBe(size.width > 1250 ? 226 : size.width > 950 ? 195 : 70);
    expect(await sidebar.evaluate(node => getComputedStyle(node).flexDirection)).toBe("column");
    expect(await page.locator("a.brand").evaluate(node => Math.round(node.getBoundingClientRect().top))).toBeGreaterThan(20);
    await page.waitForTimeout(300);
    await shot(page, `desktop-${size.width}x${size.height}-${tag}`);
  });
}
