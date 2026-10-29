import { expect, test, type Page } from "@playwright/test";

async function setupFixture(page: Page) {
  const repo = {
    id: 348,
    name: "expanded-comments-demo",
    full_name: "sample/expanded-comments-demo",
    description: "Expanded list row comments fixture",
    private: false,
    html_url: "https://github.com/sample/expanded-comments-demo",
    owner: { login: "sample" },
  };

  const old = new Date(Date.now() - 5 * 86400000).toISOString();
  const issues = [
    {
      id: 101,
      number: 1,
      title: "Task with zero comments and missing description",
      body: "",
      comments: 0,
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/1`,
      assignees: [],
      labels: [{ name: "enhancement", color: "a2eeef" }],
    },
    {
      id: 102,
      number: 2,
      title: "Task with exactly one comment and short description",
      body: "Short description text.",
      comments: 1,
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/2`,
      assignees: [],
      labels: [{ name: "bug", color: "d73a4a" }],
    },
    {
      id: 103,
      number: 3,
      title: "Task with five comments and long description",
      body: "### Detailed Overview\n\nHere is a full breakdown of the task requirements and implementation scope across multiple paragraphs.\n\n- First requirement\n- Second requirement",
      comments: 5,
      state: "open",
      created_at: old,
      updated_at: old,
      closed_at: null,
      html_url: `${repo.html_url}/issues/3`,
      assignees: [{ login: "developer-1", avatar_url: "" }],
      labels: [{ name: "priority: high", color: "b42332" }],
    },
  ];

  await page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") {
      return route.fulfill({ json: { login: "fixture-user", avatar_url: "" } });
    }
    if (url.pathname === "/user/repos") {
      return route.fulfill({ json: [repo] });
    }
    if (url.pathname.endsWith("/comments")) {
      const num = Number(url.pathname.split("/").at(-2));
      return route.fulfill({
        json: num === 2
          ? [{ id: 201, body: "Single comment body", created_at: old, user: { login: "reviewer" } }]
          : num === 3
            ? [
                { id: 301, body: "First comment", created_at: old, user: { login: "dev1" } },
                { id: 302, body: "Second comment", created_at: old, user: { login: "dev2" } },
                { id: 303, body: "Third comment", created_at: old, user: { login: "dev3" } },
                { id: 304, body: "Fourth comment", created_at: old, user: { login: "dev4" } },
                { id: 305, body: "Fifth comment", created_at: old, user: { login: "dev5" } },
              ]
            : [],
      });
    }
    if (url.pathname.endsWith("/issues")) {
      return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : issues });
    }
    if (url.pathname === "/graphql") {
      return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    }
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

test("expanded list rows place localized comments control below content and omit top duplicate toolbar", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await setupFixture(page);

  const row0 = page.locator(".issue-row", { hasText: "#1" });
  const row1 = page.locator(".issue-row", { hasText: "#2" });
  const row2 = page.locator(".issue-row", { hasText: "#3" });

  // 1. Expand row 0 (0 comments, no body, no assignees)
  await row0.locator(".row-title").click();
  const card0 = row0.locator(".row-card");
  await expect(card0).toBeVisible();

  // Acceptance criterion 1: No duplicate top toolbar with lone comment icon
  await expect(card0.locator(".details-toolbar")).toHaveCount(0);
  // Empty description is shown directly
  await expect(card0.locator(".empty-description")).toHaveText("Ingen beskrivning har lagts till.");

  // Acceptance criterion 2: Comment control placed after content with icon + text "0 kommentarer"
  const footerButton0 = card0.locator(".details-footer .comment-count");
  await expect(footerButton0).toBeVisible();
  await expect(footerButton0).toHaveClass(/comment-count-text/);
  await expect(footerButton0.locator(".comment-count-value")).toHaveText("0 kommentarer");

  // Verify footer button geometry is below description
  const descBox0 = await card0.locator(".empty-description").boundingBox();
  const footerBox0 = await footerButton0.boundingBox();
  expect(footerBox0!.y).toBeGreaterThanOrEqual(descBox0!.y + descBox0!.height);

  // Test opening dialog from footer button
  await footerButton0.click();
  const dialog0 = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
  await expect(dialog0).toBeVisible();
  await expect(dialog0.getByText("Inga kommentarer ännu.")).toBeVisible();
  await dialog0.getByRole("button", { name: "Stäng kommentarer", exact: true }).click();
  await expect(footerButton0).toBeFocused();

  // 2. Expand row 1 (1 comment, short body)
  await row1.locator(".row-title").click();
  const card1 = row1.locator(".row-card");
  await expect(card1).toBeVisible();
  await expect(card1.locator(".details-toolbar")).toHaveCount(0);
  await expect(card1.locator(".issue-markdown, .plain-description")).toContainText("Short description text.");

  const footerButton1 = card1.locator(".details-footer .comment-count");
  await expect(footerButton1).toBeVisible();
  // Acceptance criterion 2: "1 kommentar" in Swedish
  await expect(footerButton1.locator(".comment-count-value")).toHaveText("1 kommentar");

  // 3. Expand row 2 (5 comments, long body, assignees)
  await row2.locator(".row-title").click();
  const card2 = row2.locator(".row-card");
  await expect(card2).toBeVisible();
  // Has assignees, so details-toolbar renders assignees, but NOT top comments
  await expect(card2.locator(".details-toolbar .comment-count")).toHaveCount(0);
  await expect(card2.locator(".details-toolbar .assignees")).toBeVisible();

  const footerButton2 = card2.locator(".details-footer .comment-count");
  await expect(footerButton2).toBeVisible();
  await expect(footerButton2.locator(".comment-count-value")).toHaveText("5 kommentarer");

  // Screenshot wide desktop light
  await page.screenshot({ path: testInfo.outputPath("expanded-list-desktop-light.png") });

  // 4. Switch theme to dark and screenshot
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: testInfo.outputPath("expanded-list-desktop-dark.png") });

  // 5. Test English localization
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.locator("#language-preference").selectOption("en");
  await page.keyboard.press("Escape");

  await expect(footerButton0.locator(".comment-count-value")).toHaveText("0 comments");
  await expect(footerButton1.locator(".comment-count-value")).toHaveText("1 comment");
  await expect(footerButton2.locator(".comment-count-value")).toHaveText("5 comments");
  await page.screenshot({ path: testInfo.outputPath("expanded-list-desktop-english.png") });

  // 6. Test narrow desktop (1000x900)
  await page.setViewportSize({ width: 1000, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("expanded-list-narrow-desktop.png") });

  // 7. Verify Cards view retains top toolbar placement without unintentional moves
  await page.getByRole("group", { name: "Board view mode", exact: true }).getByRole("button", { name: "Cards", exact: true }).click();
  const firstCard = page.locator(".issue-card").first();
  await expect(firstCard.locator(".details-toolbar .comment-count")).toBeVisible();
  await expect(firstCard.locator(".details-footer")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("cards-view-preserved.png") });
});
