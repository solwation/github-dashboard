import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// #424: the phone drawer opens from the top bar or an edge swipe; nothing floats over page content.
const shotsDir = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (!shotsDir) return;
  mkdirSync(shotsDir, { recursive: true });
  await page.screenshot({ path: `${shotsDir}/${name}.png` });
}
const sizes = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }];
for (const size of sizes) {
  test(`drawer opener never overlaps content at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo" }).click();
    await expect(page.locator("#repo-1")).toBeVisible();
    await expect(page.locator(".sidebar-drag-handle")).toHaveCount(0);
    // No fixed element touches the left edge except the sticky top bar's own opener.
    const fixedAtEdge = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].filter(node => {
      const style = getComputedStyle(node);
      if (style.position !== "fixed" || style.display === "none" || node.closest(".sidebar, .topbar")) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.left < 48 && box.width < innerWidth * 0.5;
    }).map(node => node.className));
    expect(fixedAtEdge).toEqual([]);
    const opener = page.locator(".mobile-drawer-opener");
    const box = (await opener.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    // Scrolling through the board: content in the gutter is hit-testable (nothing sits over it).
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += Math.max(200, size.height / 2)) {
      await page.evaluate(top => window.scrollTo(0, top), y);
      const stolen = await page.evaluate(() => {
        const bad: string[] = [];
        for (const x of [2, 8, 15]) for (let yy = 80; yy < innerHeight; yy += 40) {
          const hit = document.elementFromPoint(x, yy);
          if (hit && hit.closest(".sidebar-backdrop, .sidebar-drag-handle, .mobile-drawer-opener")) bad.push(`${x},${yy}:${hit.className}`);
        }
        return bad;
      });
      expect(stolen, `scroll ${y}`).toEqual([]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await shot(page, `opener-${size.width}x${size.height}-${theme}`);
    }
    await context.close();
  });

  test(`drawer opens by opener and edge swipe, closes by Esc at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: size, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo" }).click();
    await expect(page.locator("#repo-1")).toBeVisible();
    const opener = page.locator(".mobile-drawer-opener");
    const panel = page.locator("aside.sidebar.sidebar-mobile-open");
    await opener.tap();
    await expect(panel).toBeVisible();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("aside.sidebar").locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(opener).toBeFocused();
    // Edge swipe from the left opens it.
    await page.evaluate(() => {
      const fire = (type: string, x: number) => window.dispatchEvent(new TouchEvent(type, {
        touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 200 })],
        changedTouches: [new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 200 })],
      }));
      fire("touchstart", 4); fire("touchend", 120);
    });
    await expect(panel).toBeVisible();
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await page.locator(".sidebar-backdrop").click({ position: { x: size.width - 4, y: 10 } });
    await expect(panel).toHaveCount(0);
    await opener.tap();
    await panel.locator(".sidebar-mobile-close").tap();
    await expect(panel).toHaveCount(0);
    await context.close();
  });
}
test("opener is hidden on tablet and desktop", async ({ page }) => {
  for (const size of [{ width: 800, height: 900 }, { width: 1600, height: 1000 }]) {
    await page.setViewportSize(size);
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo" }).click();
    await expect(page.locator("#repo-1")).toBeVisible();
    await expect(page.locator(".mobile-drawer-opener")).toBeHidden();
  }
});
