import { expect, test, type Page, type Locator } from "@playwright/test";
import { textAccessibility } from "./support/text-accessibility";

async function openStatistics(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await page.getByRole("link", { name: "Statistik", exact: true }).click();
  await expect(page.locator(".statistics-repository").first().locator(".statistics-total")).toHaveCount(15);
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function geometry(repository: Locator) {
  return repository.evaluate(repo => {
    const box = (element: Element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height }; };
    return {
      scrollY,
      chart: box(repo.querySelector(".statistics-chart")!),
      svg: box(repo.querySelector(".statistics-chart > svg")!),
      totals: box(repo.querySelector(".statistics-totals")!),
      groups: [...repo.querySelectorAll(".statistics-total-grid")].map(grid => ({ bounds: box(grid), tiles: [...grid.querySelectorAll(".statistics-total")].map(box) })),
      breakdowns: [...repo.querySelectorAll(".statistics-breakdown")].map(box),
      fonts: [...repo.querySelectorAll(".statistics-chart svg text")].map(text => parseFloat(getComputedStyle(text).fontSize)),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}

for (const scenario of [
  { name: "laptop", width: 1366, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "wide", width: 1600, height: 1000 },
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "rail", width: 950, height: 900 },
  { name: "phone", width: 390, height: 844, mobile: true },
]) test(`statistics density keeps complete metric rows and readable plots: ${scenario.name}`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: !!scenario.mobile, hasTouch: !!scenario.mobile, locale: "sv-SE", timezoneId: "UTC", reducedMotion: "reduce" });
  const page = await context.newPage();
  await openStatistics(page);
  const repository = page.locator(".statistics-repository").first();
  const report: unknown[] = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const period of ["3d", "30d"]) {
      await page.getByRole("combobox", { name: "Tidsintervall", exact: true }).selectOption(period);
      await page.evaluate(() => window.scrollTo(0, 0));
      const measured = await geometry(repository);
      report.push({ theme, period, ...measured });
      expect(measured.scrollY).toBe(0);
      expect(measured.scrollWidth).toBeLessThanOrEqual(scenario.width);
      expect(measured.fonts.every(font => font >= 11)).toBe(true);
      for (const group of measured.groups) {
        expect(Math.abs(group.bounds.left - measured.groups[0]!.bounds.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(group.bounds.right - measured.groups[0]!.bounds.right)).toBeLessThanOrEqual(1);
        const rows = new Map<number, typeof group.tiles>();
        for (const tile of group.tiles) {
          const row = Math.round(tile.top);
          rows.set(row, [...(rows.get(row) || []), tile]);
        }
        for (const tiles of rows.values()) {
          expect(Math.abs(tiles[0]!.left - group.bounds.left)).toBeLessThanOrEqual(1);
          expect(Math.abs(tiles.at(-1)!.right - group.bounds.right)).toBeLessThanOrEqual(1);
        }
      }
      if (scenario.name === "rail") for (const group of measured.groups)
        for (const tile of group.tiles) expect(tile.height).toBeLessThanOrEqual(64);
      if (!scenario.mobile) for (const panel of measured.breakdowns) expect(panel.height).toBeLessThanOrEqual(40);
      if (scenario.name === "laptop") expect(measured.chart.bottom).toBeLessThanOrEqual(scenario.height);
      await textAccessibility(page);
      // Original scroll position is part of the acceptance: capture the complete viewport first.
      await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-${theme}-${period}-viewport.png`) });
      if (scenario.mobile) await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-${theme}-${period}-full.png`), fullPage: true });
    }
  }
  await testInfo.attach("density-geometry", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
  const contributor = repository.locator(".statistics-breakdown").first();
  await contributor.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(contributor).toHaveJSProperty("open", true);
  await expect(contributor.getByRole("table")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(contributor).toHaveJSProperty("open", false);
  const slider = repository.getByRole("slider", { name: "Tidpunkt i diagrammet" });
  await slider.focus(); await page.keyboard.press("End");
  await expect(slider).toHaveValue("29");
  await expect(repository.getByRole("tooltip")).toContainText("Stängda issues");
  await context.close();
});

test("optional metric groups fill the available row without empty metric placeholders", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStatistics(page);
  const repository = page.locator(".statistics-repository").first();
  await repository.getByRole("combobox", { name: "Nuvarande label", exact: true }).selectOption("bug");
  await expect(repository.locator('[data-metric="commits"]')).toHaveCount(0);
  await expect(repository.locator(".statistics-total-group h3")).not.toContainText(["Kod"]);
  const measured = await geometry(repository);
  for (const group of measured.groups) expect(Math.abs(group.tiles.at(-1)!.right - group.bounds.right)).toBeLessThanOrEqual(1);
  await expect(repository.locator(".statistics-total-static")).toBeVisible();
});
