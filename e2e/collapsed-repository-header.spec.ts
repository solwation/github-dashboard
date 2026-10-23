import { expect, test } from "@playwright/test";

// Logged in, so the repository settings button is present (the demo hides it) (#267).
const repo = { id: 1, name: "collapsed-lane", full_name: "sample/collapsed-lane", private: true, description: "A repository with a fairly long description", html_url: "https://github.com/sample/collapsed-lane", owner: { login: "sample" } };
for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`collapsed repository on a ${viewport.width}×${viewport.height} phone keeps settings beside the summary`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await page.route("https://api.github.com/**", async route => {
      const url = new URL(route.request().url());
      await route.fulfill({ json: url.pathname === "/user" ? { login: "collapsed-test", avatar_url: "" }
        : url.pathname === "/user/repos" ? [repo] : url.pathname === `/repos/${repo.full_name}` ? repo : [] });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-collapsed-token");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
    await page.getByRole("checkbox", { name: repo.full_name }).check();
    await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
    const header = page.locator(".lane-header");
    const settings = header.getByRole("button", { name: `Repositoryegenskaper för ${repo.name}` });
    const summary = header.locator(".lane-summary");
    await header.getByRole("button", { name: `Kollapsa ${repo.name}` }).click();
    await expect(summary).toBeVisible();
    await expect(settings).toBeVisible();
    const [settingsBox, summaryBox, headerBox] = await Promise.all([settings, summary, header].map(async locator => (await locator.boundingBox())!));
    if (process.env.EVIDENCE_DIR) await header.screenshot({ path: `${process.env.EVIDENCE_DIR}/collapsed-header-${viewport.width}.png` });
    // Settings shares the summary's row instead of leaving a row of its own.
    expect(settingsBox.y).toBeLessThan(summaryBox.y + summaryBox.height);
    expect(settingsBox.y + settingsBox.height).toBeGreaterThan(summaryBox.y);
    expect(settingsBox.x).toBeGreaterThanOrEqual(summaryBox.x + summaryBox.width);
    expect(settingsBox.width).toBeGreaterThanOrEqual(44);
    expect(headerBox.x + headerBox.width - settingsBox.x - settingsBox.width).toBeLessThan(25);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await header.getByRole("button", { name: `Expandera ${repo.name}` }).click();
    await expect(header.getByLabel(`Filtrera issues i ${repo.full_name}`, { exact: true })).toBeVisible();
    await context.close();
  });
}
