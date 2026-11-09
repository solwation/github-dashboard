import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { connectGrouping, groupingFixture, setBoardGrouping } from "./support/board-grouping";
import { openSettings } from "./support/phone-menu";
const evidence = process.env.SWIMLANE_TABLE_EVIDENCE;
const sizes = [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }];
test("one joined List table aligns project/status cells across themes and responsive layouts", async ({ browser }) => {
  test.setTimeout(120000);
  const measurements: unknown[] = [];
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const viewport of sizes) {
    const mobile = viewport.width <= 650 || viewport.height <= 500;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); const repos = await groupingFixture(page, 3); await connectGrouping(page, repos);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(async theme => { const path = "/src/lib/theme.ts"; (await import(path)).setTheme(theme); await document.fonts.ready; }, theme);
      await expect(page.locator(".stat").first()).toHaveCSS("background-color", theme === "dark" ? "rgb(23, 33, 36)" : "rgb(255, 255, 255)");
      for (const group of ["none", "split", "swimlanes"] as const) for (const mode of ["Kort", "Lista"]) {
        await setBoardGrouping(page, group); await page.getByRole("button", { name: mode, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        if (group !== "swimlanes") continue;
        const board = page.locator(".swimlane-board"); await board.scrollIntoViewIfNeeded();
        if (mode === "Lista") {
          const table = board.locator("table"); await expect(table).toHaveCount(1); await expect(table.locator("thead th")).toHaveCount(3);
          await expect(table.locator(".swimlane-cell-count")).toHaveCount(0);
          for (const header of await table.locator(".swimlane-table-status").all()) expect((await header.boundingBox())!.height).toBeLessThanOrEqual(80);
          await expect(board.locator(".swimlane-band, .collapse-project")).toHaveCount(0);
          const geometry = await table.evaluate(table => {
            const rect = (e: Element) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right }; };
            return { headers: [...table.querySelectorAll("thead th")].map(rect), rows: [...table.querySelectorAll(".swimlane-table-status-cells")].map(row => [...row.children].map(rect)), overflow: [...table.querySelectorAll(".issue-row")].map(row => row.scrollWidth - row.clientWidth) };
          });
          for (const row of geometry.rows) for (let i = 0; i < row.length; i++) {
            expect(Math.abs(row[i]!.x - geometry.headers[i]!.x)).toBeLessThanOrEqual(1);
            expect(Math.abs(row[i]!.y - row[0]!.y)).toBeLessThanOrEqual(1);
            expect(Math.abs(row[i]!.height - row[0]!.height)).toBeLessThanOrEqual(1);
            if (i) expect(Math.abs(row[i]!.x - row[i-1]!.right)).toBeLessThanOrEqual(1);
          }
          expect(Math.max(...geometry.overflow)).toBeLessThanOrEqual(1);
          measurements.push({ viewport, theme, geometry });
          // Shared sorting stays visible and unclipped even for the final status band.
          const closed = table.locator('tbody[data-status="closed"] .swimlane-table-status .column-sort-button'); await closed.click();
          const menu = table.getByRole("menu"); await expect(menu).toBeVisible();
          const box = (await menu.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
          await menu.getByRole("menuitemradio").last().click();
          const progress = table.locator('tbody[data-status="progress"]'); await expect(progress.locator(".issue-row")).toHaveCount(2);
          if (evidence) await page.screenshot({ path: `${evidence}/${viewport.width}x${viewport.height}-${theme}-list.png` });
          await table.locator("thead th").last().scrollIntoViewIfNeeded();
          if (evidence) await page.screenshot({ path: `${evidence}/${viewport.width}x${viewport.height}-${theme}-scrolled.png` });
        } else if (evidence) await page.screenshot({ path: `${evidence}/${viewport.width}x${viewport.height}-${theme}-cards.png` });
      }
    }
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/geometry.json`, JSON.stringify(measurements, null, 2));
});

test("List cell counters appear only while the display limit hides issues", async ({ page }) => {
  const repos = await groupingFixture(page, 3); await connectGrouping(page, repos);
  await setBoardGrouping(page, "swimlanes");
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  const table = page.locator(".swimlane-table");
  const counters = table.locator(".swimlane-cell-count");
  await expect(counters).toHaveCount(0);
  const setLimit = async (limit: string) => {
    await openSettings(page);
    await page.locator("#global-column-limit").fill(limit);
    await page.getByRole("button", { name: "Klart", exact: true }).click();
  };
  await setLimit("1");
  await expect(counters).toHaveCount(3);
  for (const counter of await counters.all()) await expect(counter).toHaveText("2");
  await expect(table.locator('tbody[data-status="progress"] .swimlane-cell-count')).toHaveCount(0);
  const alpha = table.locator('tbody[data-status="backlog"] td[data-repository="sample/alpha"]');
  await alpha.getByRole("button", { name: "Visa fler", exact: true }).press("Enter");
  await expect(alpha.locator(".issue-row")).toHaveCount(2);
  await expect(table.locator('tbody[data-status="backlog"] .swimlane-cell-count[data-repository="sample/alpha"]')).toHaveCount(0);
  await expect(counters).toHaveCount(2);
  const search = page.getByRole("textbox", { name: "Sök issues", exact: true });
  await search.fill("second backlog task");
  await expect(counters).toHaveCount(0);
  await search.fill("");
  await expect(counters).toHaveCount(2);
  await setLimit("2");
  await expect(counters).toHaveCount(0);
  await expect(table.locator('tbody[data-status="backlog"] .swimlane-table-status .column-count')).toHaveText("6");
});

test("List cell counters sit in the status row above their column without pushing rows down (#441)", async ({ browser }) => {
  test.setTimeout(120000);
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const viewport of sizes) {
    const mobile = viewport.width <= 650 || viewport.height <= 500;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); const repos = await groupingFixture(page, 3); await connectGrouping(page, repos);
    await setBoardGrouping(page, "swimlanes"); await page.getByRole("button", { name: "Lista", exact: true }).click();
    await openSettings(page); await page.locator("#global-column-limit").fill("1"); await page.getByRole("button", { name: "Klart", exact: true }).click();
    const band = page.locator('.swimlane-table tbody[data-status="backlog"]');
    await expect(band.locator(".swimlane-table-status .swimlane-cell-count")).toHaveCount(3);
    await expect(band.locator(".swimlane-table-status-cells .swimlane-cell-count")).toHaveCount(0);
    await expect(band.locator(".swimlane-cell-count-label")).toHaveText(["Backlog: 2", "Backlog: 2", "Backlog: 2"]);
    for (const step of ["start", "end"]) {
      if (step === "end") await page.locator(".swimlane-table thead th").last().scrollIntoViewIfNeeded();
      const layout = await band.evaluate(band => {
        const r = (e: Element) => e.getBoundingClientRect().toJSON() as DOMRect;
        const viewport = band.closest(".swimlane-table-viewport")!.getBoundingClientRect();
        return {
          viewport: { left: viewport.left, right: viewport.right },
          status: r(band.querySelector(".swimlane-table-status th")!),
          counts: [...band.querySelectorAll(".swimlane-table-status .swimlane-cell-count")].map(e => ({ repo: e.getAttribute("data-repository")!, ...r(e) })),
          cells: [...band.querySelectorAll(".swimlane-table-cell")].map(e => ({ repo: e.getAttribute("data-repository")!, ...r(e) })),
          rows: [...band.querySelectorAll(".swimlane-table-cell .issue-row")].map(e => r(e).top),
          heading: r(band.querySelector(".swimlane-table-status .column-heading")!),
          sort: r(band.querySelector(".swimlane-table-status .column-sort-button")!),
        };
      });
      expect(Math.max(...layout.rows) - Math.min(...layout.rows)).toBeLessThanOrEqual(1);
      for (const count of layout.counts) {
        const cell = layout.cells.find(cell => cell.repo === count.repo)!;
        expect(count.top).toBeGreaterThanOrEqual(layout.status.top); expect(count.bottom).toBeLessThanOrEqual(layout.status.bottom);
        expect(Math.abs((count.left + count.right) / 2 - (cell.left + cell.right) / 2)).toBeLessThanOrEqual(1);
        // Only counts visible in the scroll viewport must clear the sticky status label and sort control.
        if (count.right <= layout.viewport.left || count.left >= layout.viewport.right) continue;
        for (const other of [layout.heading, layout.sort]) expect(count.right <= other.left || count.left >= other.right, `${viewport.width}x${viewport.height} ${step} ${count.repo}`).toBe(true);
      }
      if (evidence) await page.screenshot({ path: `${evidence}/counts-${viewport.width}x${viewport.height}-${step}.png` });
    }
    await context.close();
  }
});
