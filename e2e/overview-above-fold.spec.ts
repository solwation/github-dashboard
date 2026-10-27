import { expect, test } from "@playwright/test";

test("1366x768: first issue starts <= 360px and at least one full card is visible", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".issue-card").first()).toBeVisible();
  const firstCard = (await page.locator(".issue-card").first().boundingBox())!;
  // Acceptance criterion #332: first issue card/row starts at <= 360px from top
  expect(firstCard.y).toBeLessThanOrEqual(360);
  // and at least one full card is visible above the fold
  expect(768 - firstCard.y).toBeGreaterThanOrEqual(firstCard.height);
});

test("390x844: first issue is visible without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".issue-card").first()).toBeVisible();
  const firstCard = (await page.locator(".issue-card").first().boundingBox())!;
  // Acceptance criterion #332: at least start of first issue in first column is visible without scrolling
  expect(firstCard.y).toBeLessThan(844);
});

test("844x390 landscape mobile: first issue is visible without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".issue-card").first()).toBeVisible();
  const firstCard = (await page.locator(".issue-card").first().boundingBox())!;
  // Acceptance criterion #332: at least start of first issue in first column is visible without scrolling
  expect(firstCard.y).toBeLessThan(390);
});

const scenarios = [
  { name: "wide-desktop-1600x1000", width: 1600, height: 1000 },
  { name: "narrow-desktop-1000x900", width: 1000, height: 900 },
  { name: "rail-desktop-950x700", width: 950, height: 700 },
  { name: "mobile-portrait-390x844", width: 390, height: 844 },
  { name: "mobile-landscape-844x390", width: 844, height: 390 },
  { name: "narrow-phone-320x568", width: 320, height: 568 },
];

for (const scenario of scenarios) {
  test(`overview layout in light and dark theme (${scenario.name})`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo" }).click();
    await expect(page.locator(".issue-card").first()).toBeVisible();
    await expect(page.locator(".stats .stat")).toHaveCount(4);

    // No horizontal scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // Light theme screenshot
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-light.png`) });

    // Dark theme
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-dark.png`) });
  });
}
