import { expect, test } from "@playwright/test";
import { textAccessibility } from "./support/text-accessibility";
import { openSettings, closePhoneMenu } from "./support/phone-menu";

// Shared tokens also feed non-board surfaces; verify representative edge consumers.
for (const width of [1600, 950, 390]) for (const theme of ["light", "dark"] as const) {
  test(`secondary text in overview, hover, settings and statistics ${width} ${theme}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width === 390, hasTouch: width === 390, colorScheme: theme, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/");
    await textAccessibility(page);
    await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
    await expect(page.locator(".issue-card").first()).toBeVisible();
    const overview = await textAccessibility(page);
    await info.attach("overview-text", { body: JSON.stringify(overview), contentType: "application/json" });
    if (width === 1600) {
      // Hover adds translucent layers over surfaces, rather than replacing the base colour.
      for (const selector of [".sidebar-version", ".sidebar-footer", ".sidebar-repository", ".column-sort-button"]) {
        await page.locator(selector).first().hover();
        await page.waitForTimeout(200);
        await textAccessibility(page);
      }
    }
    await openSettings(page);
    await expect(page.getByRole("dialog", { name: "Inställningar", exact: true })).toBeVisible();
    await textAccessibility(page);
    await page.screenshot({ path: info.outputPath("settings.png") });
    await page.getByRole("button", { name: "Klart", exact: true }).click();
    await closePhoneMenu(page);
    await page.getByRole("link", { name: "Statistik", exact: true }).click();
    await expect(page.locator(".statistics-repository").first()).toBeVisible();
    const statistics = await textAccessibility(page);
    await info.attach("statistics-text", { body: JSON.stringify(statistics), contentType: "application/json" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("statistics.png") });
    await context.close();
  });
}
