import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";

const devices = [
  { width: 1600, height: 1000, mobile: false },
  { width: 1000, height: 900, mobile: false },
  { width: 950, height: 900, mobile: false },
  { width: 390, height: 844, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 320, height: 568, mobile: true },
];

for (const device of devices) for (const list of [false, true]) {
  test(`compact headers ${list ? "List" : "Cards"} ${device.width}x${device.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: device, isMobile: device.mobile, hasTouch: device.mobile, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
    if (list) await page.getByRole("button", { name: "Lista", exact: true }).click();
    const lane = page.locator("#repo-1");
    const toggle = lane.getByRole("button", { name: "Filtrera issues i demo/design-system", exact: true });
    const input = lane.getByRole("textbox", { name: "Filtrera issues i demo/design-system", exact: true });
    await expect(input).toBeHidden();
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(input).toBeFocused();
    await input.fill("bug");
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("title", "Aktivt filter: bug");
    await expect(toggle.locator(".repository-filter-indicator")).toBeVisible();
    await toggle.click(); await expect(input).toHaveValue("bug");
    await lane.getByRole("button", { name: "Rensa filtret för demo/design-system", exact: true }).click();
    await page.keyboard.press("Escape");
    const measurements: unknown[] = [];
    for (const theme of ["light", "dark"]) for (const split of [true, false]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).setChecked(split);
      await expect(page.locator(".combined-board-head")).toHaveCount(0);
      const board = split ? lane : page.locator(".combined-board");
      await board.scrollIntoViewIfNeeded();
      const sample = await page.evaluate(() => {
        const headers = [...document.querySelectorAll<HTMLElement>(".repo-lane:not(.statistics-repository) .lane-header")];
        const boxes = headers.map(header => {
          const box = header.getBoundingClientRect();
          const title = header.querySelector(".lane-title")!.getBoundingClientRect();
          const meta = header.querySelector(".lane-meta")!.getBoundingClientRect();
          const sync = header.querySelector(".lane-sync")!.getBoundingClientRect();
          return { height: box.height, inset: title.left - box.left, right: box.right - meta.right,
            centerDifference: Math.abs((title.top + title.bottom) / 2 - (meta.top + meta.bottom) / 2),
            overflow: header.scrollWidth > header.clientWidth,
            syncInside: sync.left >= box.left && sync.right <= box.right };
        });
        return { boxes, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      measurements.push({ theme, split, ...sample });
      expect(sample.overflow).toBe(false);
      for (const header of sample.boxes) {
        expect(header.overflow).toBe(false);
        expect(header.syncInside).toBe(true);
        if (device.width >= 1000) {
          expect(header.height).toBeLessThanOrEqual(50);
          expect(header.centerDifference).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(header.inset - sample.boxes[0]!.inset)).toBeLessThanOrEqual(1);
        expect(Math.abs(header.right - sample.boxes[0]!.right)).toBeLessThanOrEqual(1);
      }
      if (!split) {
        await expect(page.locator(".board-toolbar .combined-sync time")).toHaveAttribute("title", /^Senast uppdaterad/);
        const columns = board.locator(".swimlane");
        expect(Math.abs((await board.boundingBox())!.y + 1 - (await columns.boundingBox())!.y)).toBeLessThanOrEqual(1);
      }
      // Keep the sync toolbar and the board header in the same evidence frame.
      await page.evaluate(() => {
        const toolbar = document.querySelector(".board-toolbar")!.getBoundingClientRect();
        const topbar = document.querySelector(".topbar")!.getBoundingClientRect();
        scrollTo(0, scrollY + toolbar.top - topbar.height - 8);
        (document.activeElement as HTMLElement)?.blur();
      });
      if (process.env.EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/${list ? "list" : "cards"}-${device.width}-${theme}-${split ? "split" : "combined"}.png` });
    }
    if (process.env.EVIDENCE_DIR) writeFileSync(`${process.env.EVIDENCE_DIR}/geometry-${list ? "list" : "cards"}-${device.width}.json`, JSON.stringify(measurements, null, 2));
    await context.close();
  });
}
