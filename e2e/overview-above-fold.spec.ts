import { expect, test } from "@playwright/test";

test("1366x768: a full first issue remains visible beneath the restored summary", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".issue-card").first()).toBeVisible();
  const firstCard = (await page.locator(".issue-card").first().boundingBox())!;
  // #346 restores the taller summary; retain the useful full-card visibility check from #332.
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

const scenarios = [
  { name: "wide-desktop-1600x1000", width: 1600, height: 1000 },
  { name: "narrow-desktop-1000x900", width: 1000, height: 900 },
  { name: "rail-desktop-950x700", width: 950, height: 700 },
  { name: "mobile-portrait-390x844", width: 390, height: 844 },
  { name: "mobile-landscape-844x390", width: 844, height: 390 },
  { name: "narrow-phone-320x568", width: 320, height: 568 },
];

for (const scenario of scenarios) {
  test(`overview layout in light and dark theme (${scenario.name})`, async ({ browser }, testInfo) => {
    const mobile = scenario.name.includes("mobile") || scenario.name.includes("phone");
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: mobile, hasTouch: mobile, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Utforska en demo" }).click();
    await expect(page.locator(".issue-card").first()).toBeVisible();
    await expect(page.locator(".stats .stat")).toHaveCount(4);

    const geometry = await page.locator(".stats .stat").evaluateAll(cards => cards.map(card => {
      const content = card.querySelector(".stat-content")!.getBoundingClientRect();
      const label = card.querySelector(".stat-label")!.getBoundingClientRect();
      const figure = card.querySelector("strong")!.getBoundingClientRect();
      const estimate = card.querySelector(".overview-estimate")!.getBoundingClientRect();
      const footer = card.querySelector(".stat-cells")!.getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      return { lefts: [label.left, figure.left, estimate.left, footer.left], contentLeft: content.left,
        order: label.bottom <= figure.top + 1 && figure.bottom <= estimate.top + 1 && estimate.bottom <= footer.top + 1,
        fits: card.scrollWidth <= card.clientWidth && footer.bottom <= bounds.bottom,
        height: bounds.height, font: getComputedStyle(card.querySelector("strong")!).fontSize };
    }));
    for (const card of geometry) {
      expect(card.order).toBe(true);
      expect(card.fits).toBe(true);
      expect(card.font).toBe("27px");
      if (!mobile) for (const left of card.lefts) expect(Math.abs(left - card.contentLeft)).toBeLessThanOrEqual(1);
    }
    await testInfo.attach("summary-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
    // No horizontal scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    await page.evaluate(() => window.scrollTo(0, 0));
    // Light theme screenshot
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-light.png`) });
    await page.locator(".stats").screenshot({ path: testInfo.outputPath(`${scenario.name}-summary-light.png`) });

    // Dark theme
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-dark.png`) });
    await page.locator(".stats").screenshot({ path: testInfo.outputPath(`${scenario.name}-summary-dark.png`) });
    await context.close();
  });
}
