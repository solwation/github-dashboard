import { expect, test } from "@playwright/test";
import { closePhoneMenu, openSettings } from "./support/phone-menu";
for (const scenario of [
  { name: "wide", width: 1600, height: 1000, mobile: false },
  { name: "rail", width: 950, height: 900, mobile: false },
  { name: "phone", width: 390, height: 844, mobile: true },
]) test(`combined statistics keeps all repositories, filters and period: ${scenario.name}`, async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: scenario.mobile, hasTouch: scenario.mobile, locale: "sv-SE", timezoneId: "UTC", reducedMotion: "reduce" });
  const page = await context.newPage();
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo" }).click();
    await page.getByRole("link", { name: "Statistik", exact: true }).click();
    const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
    await expect(split).toBeChecked();
    if (scenario.mobile) expect((await page.locator(".statistics-split-toggle").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const first = page.locator("#statistics-repo-1"), second = page.locator("#statistics-repo-2");
    await expect(second.locator(".statistics-repository-toggle")).toHaveAttribute("aria-expanded", "false");
    await first.getByRole("combobox", { name: "Nuvarande label", exact: true }).selectOption("bug");
    await page.getByRole("combobox", { name: "Tidsintervall", exact: true }).selectOption("30d");
    await expect(first.locator('[data-metric="closed"] strong')).toHaveText("2");
    await split.focus(); await split.press("Space");
    const combined = page.locator(".statistics-combined-chart");
    await expect(page.locator(".statistics-chart")).toHaveCount(1);
    await expect(combined).toHaveAttribute("aria-labelledby", "statistics-repository--1");
    await expect(combined.locator("#statistics-repository--1")).toHaveText("Alla valda repositories");
    await expect(combined.locator('[data-metric="closed"] strong')).toHaveText("6");
    await expect(combined.locator('[data-metric="timePerPoint"]')).toHaveCount(0);
    await second.getByRole("combobox", { name: "Bidragsgivare", exact: true }).selectOption("demo-alex");
    await expect(combined.locator('[data-metric="closed"] strong')).toHaveText("5");
    const filterEdges = await page.locator(".statistics-combined .statistics-repo-filters").evaluateAll(elements => elements.map(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
    expect(filterEdges).toHaveLength(3);
    expect(Math.max(...filterEdges.map(box => box.left)) - Math.min(...filterEdges.map(box => box.left))).toBeLessThanOrEqual(1);
    expect(Math.max(...filterEdges.map(box => box.right)) - Math.min(...filterEdges.map(box => box.right))).toBeLessThanOrEqual(1);
    const values = await combined.locator(".statistics-chart circle title").allTextContents();
    expect(values.reduce((sum, text) => sum + Number(text.split(": ").at(-1)!.replace(/[^\d-]/g, "") || 0), 0)).toBe(5);
    for (const language of ["sv", "en"]) {
      if (language === "en") {
        await openSettings(page);
        await page.getByLabel("Språk", { exact: true }).selectOption("en");
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await closePhoneMenu(page);
      }
      await expect(page.getByRole("checkbox", { name: language === "sv" ? "Dela upp per repository" : "Split by repository", exact: true })).not.toBeChecked();
      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await combined.screenshot({ path: info.outputPath(`${scenario.name}-${language}-${theme}-chart.png`) });
        await page.locator(".statistics-repositories").screenshot({ path: info.outputPath(`${scenario.name}-${language}-${theme}-filters.png`) });
      }
    }
    const englishSplit = page.getByRole("checkbox", { name: "Split by repository", exact: true });
    await englishSplit.check();
    await expect(first.getByRole("combobox", { name: "Current label", exact: true })).toHaveValue("bug");
    await expect(second.getByRole("combobox", { name: "Contributors", exact: true })).toHaveValue("demo-alex");
    await expect(second.locator(".statistics-repository-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(first.locator('[data-metric="closed"] strong')).toHaveText("2");
    await expect(page.getByRole("combobox", { name: "Time range", exact: true })).toHaveValue("30d");
    await englishSplit.uncheck();
    await expect(combined.locator('[data-metric="closed"] strong')).toHaveText("5");
    await expect(page.locator(".statistics-chart")).toHaveCount(1);
  } finally { await context.close(); }
});
