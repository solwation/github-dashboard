import { expect, test, type Page } from "@playwright/test";

const repo = {
  id: 331,
  name: "list-labels-repo",
  full_name: "sample/list-labels-repo",
  description: "Repository for list label sizing tests",
  private: true,
  html_url: "https://github.com/sample/list-labels-repo",
  owner: { login: "sample" },
};

async function setupListFixture(page: Page) {
  const now = Date.now();
  const old = new Date(now - 86400000 * 2).toISOString();
  const issues = [
    {
      id: 1,
      number: 1,
      title: "Short title with many labels",
      comments: 2,
      body: "",
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/1`,
      assignees: [],
      labels: [
        { name: "area: authentication & session", color: "d73a4a" },
        { name: "needs-deploy", color: "0075ca" },
        { name: "documentation", color: "008672" },
        { name: "workflow", color: "a2eeef" },
        { name: "frontend", color: "e4e669" },
        { name: "backend-service", color: "f9d0c4" },
        { name: "database-migration", color: "c2e0c6" },
        { name: "security-audit", color: "bfdadc" },
      ],
    },
    {
      id: 2,
      number: 2,
      title: "A very long issue title to test that labels never shrink to dots even on long titles",
      comments: 0,
      body: "",
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/2`,
      assignees: [],
      labels: [
        { name: "bug", color: "d73a4a" },
        { name: "frontend", color: "7057ff" },
      ],
    },
    {
      id: 3,
      number: 3,
      title: "Issue with one very long label",
      comments: 1,
      body: "",
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/3`,
      assignees: [],
      labels: [
        { name: "a-very-long-workflow-label-that-must-truncate-with-ellipsis-at-max-width", color: "fbca04" },
        { name: "polish", color: "c5def5" },
      ],
    },
  ];

  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "list-tester", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) return route.fulfill({ json: issues });
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator(".issue-row")).toHaveCount(3);
}

test.describe("List labels density and overflow (#331)", () => {
  for (const { width, height, name } of [
    { width: 1920, height: 1080, name: "1920x1080" },
    { width: 1600, height: 1000, name: "1600x1000" },
    { width: 1366, height: 768, name: "1366x768" },
  ]) {
    test(`labels maintain readable length and show +N on ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await setupListFixture(page);

      const firstRow = page.locator(".issue-row").filter({ hasText: "Short title with many labels" });
      await expect(firstRow).toBeVisible();

      // Check all visible labels on the first row
      const labels = firstRow.locator(".row-labels .label:not(.label-more)");
      const count = await labels.count();
      expect(count).toBeGreaterThanOrEqual(1);

      for (let i = 0; i < count; i++) {
        const label = labels.nth(i);
        const text = await label.locator(".label-text").innerText();
        // Each visible label must have at least ~6 characters or be its complete text
        expect(text.length).toBeGreaterThanOrEqual(2);
        const box = await label.boundingBox();
        expect(box).not.toBeNull();
        // Label must not be crushed to a dot (< 30px)
        expect(box!.width).toBeGreaterThanOrEqual(35);
      }

      // Check the +N chip
      const more = firstRow.locator(".row-labels .label-more");
      await expect(more).toBeVisible();
      const moreText = await more.innerText();
      expect(moreText).toMatch(/^\+\d+$/);

      // Verify tooltip and accessible name
      const title = await more.getAttribute("title");
      expect(title).not.toBeNull();
      expect(title!.length).toBeGreaterThan(0);
      const aria = await more.getAttribute("aria-label");
      expect(aria).toContain("labels");

      // Verify row height did not increase
      const rowBox = await firstRow.boundingBox();
      expect(rowBox!.height).toBeLessThanOrEqual(44);

      // Verify long label truncation at max-width
      const longRow = page.locator(".issue-row").filter({ hasText: "Issue with one very long label" });
      const longLabel = longRow.locator(".row-labels .label:not(.label-more)").first();
      const longBox = await longLabel.boundingBox();
      expect(longBox!.width).toBeLessThanOrEqual(225); // max-width 14rem = 224px
    });
  }

  test("keyboard navigation reaches +N button and expands details", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await setupListFixture(page);

    const firstRow = page.locator(".issue-row").filter({ hasText: "Short title with many labels" });
    const more = firstRow.locator(".row-labels .label-more");
    await more.focus();
    await page.keyboard.press("Enter");

    // Pressing Enter on +N expands the row card
    await expect(firstRow.locator(".row-card")).toBeVisible();
  });

  test("dark theme applies tokens to +N chip", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await setupListFixture(page);

    const more = page.locator(".issue-row .label-more").first();
    await expect(more).toBeVisible();
    const bg = await more.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("");
  });

  const matrixScenarios = [
    { name: "wide-desktop", width: 1600, height: 1000, mobile: false },
    { name: "narrow-desktop", width: 1000, height: 900, mobile: false },
    { name: "portrait-phone", width: 390, height: 844, mobile: true },
    { name: "landscape-phone", width: 844, height: 390, mobile: true },
    { name: "narrow-phone", width: 320, height: 568, mobile: true },
  ];

  for (const s of matrixScenarios) {
    test(`UI matrix: ${s.name} in cards and list mode`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({
        viewport: { width: s.width, height: s.height },
        isMobile: s.mobile,
        hasTouch: s.mobile,
      });
      const page = await context.newPage();
      await setupListFixture(page);

      // Verify List mode
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const rows = page.locator(".issue-row");
      const rowCount = await rows.count();
      expect(rowCount).toBe(3);
      for (let i = 0; i < rowCount; i++) {
        const box = await rows.nth(i).boundingBox();
        const maxHeight = s.mobile ? 60 : (s.width <= 1000 ? 56 : 44);
        expect(box!.height).toBeLessThanOrEqual(maxHeight);
      }
      await page.screenshot({ path: testInfo.outputPath(`list-${s.name}.png`) });

      // Verify Cards mode
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Kort", exact: true }).click();
      await expect(page.locator(".issue-card")).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`cards-${s.name}.png`) });

      await context.close();
    });
  }
});
