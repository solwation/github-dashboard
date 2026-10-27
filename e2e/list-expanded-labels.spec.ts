import { expect, test, type Page } from "@playwright/test";
import { textAccessibility } from "./support/text-accessibility";

const repo = {
  id: 341,
  name: "expanded-labels-repo",
  full_name: "sample/expanded-labels-repo",
  description: "Repository for list expanded labels test",
  private: true,
  html_url: "https://github.com/sample/expanded-labels-repo",
  owner: { login: "sample" },
};

const longLabels = [
  { name: "area: authentication-session-tokens-validation", color: "d73a4a" },
  { name: "infrastructure: database-migration-script-v2", color: "0075ca" },
  { name: "documentation: developer-onboarding-workflow", color: "008672" },
  { name: "compliance: security-vulnerability-audit", color: "a2eeef" },
  { name: "ux: accessibility-wcag-contrast-review", color: "e4e669" },
  { name: "performance: bundle-size-optimization-target", color: "f9d0c4" },
  { name: "backend-microservice-coordination-layer", color: "c2e0c6" },
];

async function setupFixture(page: Page) {
  const now = Date.now();
  const old = new Date(now - 86400000 * 2).toISOString();
  const issues = [
    {
      id: 101,
      number: 101,
      title: "Core issue with many long labels for expansion testing",
      comments: 3,
      body: "Detailed description of the issue under test.",
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/101`,
      assignees: [],
      labels: longLabels,
    },
    {
      id: 102,
      number: 102,
      title: "Simple task with single label",
      comments: 0,
      body: "Simple body",
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/102`,
      assignees: [],
      labels: [{ name: "simple", color: "7057ff" }],
    },
  ];

  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "tester", avatar_url: "" } });
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
  await expect(page.locator(".issue-row")).toHaveCount(2);
}

test.describe("List expanded labels (#341)", () => {
  test("shows all labels in full text without truncation in expanded desktop panel and mobile popup", async ({ page }) => {
    // 1. Desktop test (1600x1000)
    await page.setViewportSize({ width: 1600, height: 1000 });
    await setupFixture(page);

    const row = page.locator(".issue-row").filter({ hasText: "#101" });
    const toggle = row.getByRole("button", { name: /Core issue with many long labels/ });

    // Collapsed state: row has compact labels with +N
    await expect(row.locator(".row-meta .label-more")).toBeVisible();
    await expect(row.locator(".row-card")).toHaveCount(0);

    // Expand on desktop
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    const rowCard = row.locator(".row-card");
    await expect(rowCard).toBeVisible();

    const desktopLabelsGroup = rowCard.locator(".row-expanded-labels");
    await expect(desktopLabelsGroup).toBeVisible();
    await textAccessibility(page);
    await expect(desktopLabelsGroup).toHaveAttribute("role", "group");
    await expect(desktopLabelsGroup).toHaveAttribute("aria-label", "Labels");

    const desktopLabels = desktopLabelsGroup.locator(".label");
    await expect(desktopLabels).toHaveCount(longLabels.length);

    for (let i = 0; i < longLabels.length; i++) {
      const labelText = desktopLabels.nth(i).locator(".label-text");
      await expect(labelText).toHaveText(longLabels[i]!.name);
    }

    // Verify wrapping and no horizontal overflow on desktop
    const desktopOverflow = await desktopLabelsGroup.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(desktopOverflow).toBe(false);

    // Close on desktop
    await rowCard.getByRole("button", { name: "Stäng", exact: true }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(row.locator(".row-card")).toHaveCount(0);

    // 2. Mobile popup test (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.click();

    const popup = page.getByRole("dialog", { name: /Core issue with many long labels/ });
    await expect(popup).toBeVisible();

    const mobileLabelsGroup = popup.locator(".row-expanded-labels");
    await expect(mobileLabelsGroup).toBeVisible();
    await textAccessibility(page);
    await expect(mobileLabelsGroup).toHaveAttribute("role", "group");
    await expect(mobileLabelsGroup).toHaveAttribute("aria-label", "Labels");

    const mobileLabels = mobileLabelsGroup.locator(".label");
    await expect(mobileLabels).toHaveCount(longLabels.length);

    for (let i = 0; i < longLabels.length; i++) {
      const labelText = mobileLabels.nth(i).locator(".label-text");
      await expect(labelText).toHaveText(longLabels[i]!.name);
      // Ensure long labels wrap within max-width without overflowing the popup
      const labelEl = mobileLabels.nth(i);
      const isOverflowing = await labelEl.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(isOverflowing).toBe(false);
    }

    const popupOverflow = await popup.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(popupOverflow).toBe(false);

    // Close mobile popup
    await popup.locator(".row-popup-close").click();
    await expect(popup).toHaveCount(0);
  });

  test("verified across full viewport matrix in split and combined modes with light and dark themes", async ({ page }) => {
    const viewports = [
      { width: 1600, height: 1000 },
      { width: 1000, height: 900 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
      { width: 320, height: 568 },
    ];

    await page.setViewportSize({ width: 1600, height: 1000 });
    await setupFixture(page);

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });

        for (const combined of [false, true]) {
          const splitCheckbox = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
          const isChecked = await splitCheckbox.isChecked();
          if (combined && isChecked) {
            await splitCheckbox.uncheck();
          } else if (!combined && !isChecked) {
            await splitCheckbox.check();
          }

          const row = page.locator(".issue-row").filter({ hasText: "#101" });
          const toggle = row.getByRole("button", { name: /Core issue with many long labels/ });

          // Expand
          await toggle.click();

          const isPhone = await page.evaluate(() =>
            window.matchMedia("(max-width: 650px), (pointer: coarse) and (max-width: 950px) and (max-height: 500px)").matches
          );

          if (isPhone) {
            const popup = page.getByRole("dialog", { name: /Core issue with many long labels/ });
            await expect(popup).toBeVisible();
            const labels = popup.locator(".row-expanded-labels .label");
            await expect(labels).toHaveCount(longLabels.length);

            // Assert no horizontal document or popup scrollbar
            const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            expect(docOverflow).toBe(false);

            await popup.locator(".row-popup-close").click();
            await expect(popup).toHaveCount(0);
          } else {
            const rowCard = row.locator(".row-card");
            await expect(rowCard).toBeVisible();
            const labels = rowCard.locator(".row-expanded-labels .label");
            await expect(labels).toHaveCount(longLabels.length);

            const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            expect(docOverflow).toBe(false);

            await rowCard.getByRole("button", { name: "Stäng", exact: true }).click();
            await expect(rowCard).toHaveCount(0);
          }
        }
      }
    }
  });

test.describe("Landscape phone touch (#341)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

  test("verified on landscape phone (844x390 touch)", async ({ page }) => {
    await setupFixture(page);

    const row = page.locator(".issue-row").filter({ hasText: "#101" });
    const toggle = row.getByRole("button", { name: /Core issue with many long labels/ });

    await toggle.click();

    const popup = page.getByRole("dialog", { name: /Core issue with many long labels/ });
    await expect(popup).toBeVisible();

    const labels = popup.locator(".row-expanded-labels .label");
    await expect(labels).toHaveCount(longLabels.length);

    for (let i = 0; i < longLabels.length; i++) {
      const labelText = labels.nth(i).locator(".label-text");
      await expect(labelText).toHaveText(longLabels[i]!.name);
    }

    const docOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(docOverflow).toBe(false);

    await popup.locator(".row-popup-close").click();
    await expect(popup).toHaveCount(0);
  });
});
});
