import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const repo = {
  id: 314,
  name: "escape-dialog-repo",
  full_name: "sample/escape-dialog-repo",
  description: "Escape dialog nested fixture",
  private: true,
  html_url: "https://github.com/sample/escape-dialog-repo",
  owner: { login: "sample" },
};
const timestamp = "2026-10-26T10:00:00Z";

async function setupBoard(page: Page, context: BrowserContext, commentsBody: string, mode: "Lista" | "Kort" = "Lista") {
  await context.route("https://images.example/**", route =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#287f83"/></svg>',
    }),
  );

  await context.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/comments")) {
      return route.fulfill({
        json: [
          {
            id: 101,
            body: commentsBody,
            html_url: `${repo.html_url}/issues/1#issuecomment-101`,
            created_at: timestamp,
            user: { login: "fixture-author" },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/issues")) {
      return route.fulfill({
        json: [
          {
            id: 3141,
            number: 1,
            title: "Nested escape task",
            comments: 1,
            body: "Task description for nested escape testing",
            state: "open",
            created_at: timestamp,
            updated_at: timestamp,
            closed_at: null,
            html_url: `${repo.html_url}/issues/1`,
            assignees: [],
            labels: [{ name: "enhancement", color: "a2eeef" }],
          },
        ],
      });
    }
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-token-314");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: mode, exact: true }).click();
}

test.describe("phone comments escape handling (#314)", () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } });

  test("Escape in phone comments dialog closes only comments and returns focus, second Escape closes popup", async ({ page, context }) => {
    await setupBoard(page, context, "Discussion content in mobile comments dialog");

    const row = page.locator(".issue-row").first();
    const rowTitle = row.locator(".row-title");
    await expect(rowTitle).toBeVisible();

    // Open issue popup in phone list view
    await rowTitle.click();
    const popupDialog = page.locator(".row-popup");
    await expect(popupDialog).toBeVisible();

    // Inside the popup, find the comment button and click it to open comments dialog
    const commentBtn = popupDialog.locator(".comment-count");
    await expect(commentBtn).toBeVisible();
    await commentBtn.click();

    const commentsDialog = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
    await expect(commentsDialog).toBeVisible();
    await expect(commentsDialog.getByText("Discussion content in mobile comments dialog")).toBeVisible();

    // First Escape: closes only the comments dialog; popup remains open; focus returns to comment button
    await page.keyboard.press("Escape");
    await expect(commentsDialog).not.toBeVisible();
    await expect(popupDialog).toBeVisible();
    await expect(commentBtn).toBeFocused();

    // Second Escape: closes the issue popup and returns focus to row title
    await page.keyboard.press("Escape");
    await expect(popupDialog).not.toBeVisible();
    await expect(rowTitle).toBeFocused();
  });

  test("Escape in image viewer inside phone comments dialog closes only viewer, then comments, then popup", async ({ page, context }) => {
    await setupBoard(page, context, "Comment with an image: ![Attachment](https://images.example/test-image.png)");

    const row = page.locator(".issue-row").first();
    const rowTitle = row.locator(".row-title");
    await expect(rowTitle).toBeVisible();

    // Open issue popup
    await rowTitle.click();
    const popupDialog = page.locator(".row-popup");
    await expect(popupDialog).toBeVisible();

    // Open comments dialog
    const commentBtn = popupDialog.locator(".comment-count");
    await commentBtn.click();
    const commentsDialog = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
    await expect(commentsDialog).toBeVisible();

    // Open image viewer from comment
    const thumbnail = commentsDialog.getByRole("button", { name: "Öppna bild: Attachment", exact: true });
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();

    const viewer = page.getByRole("dialog", { name: "Bildvisare", exact: true });
    await expect(viewer).toBeVisible();

    // First Escape: closes only image viewer; comments dialog and popup remain open; focus returns to thumbnail
    await page.keyboard.press("Escape");
    await expect(viewer).not.toBeVisible();
    await expect(commentsDialog).toBeVisible();
    await expect(popupDialog).toBeVisible();
    await expect(thumbnail).toBeFocused();

    // Second Escape: closes comments dialog; popup remains open; focus returns to comment button
    await page.keyboard.press("Escape");
    await expect(commentsDialog).not.toBeVisible();
    await expect(popupDialog).toBeVisible();
    await expect(commentBtn).toBeFocused();

    // Third Escape: closes popup; row title is refocused
    await page.keyboard.press("Escape");
    await expect(popupDialog).not.toBeVisible();
    await expect(rowTitle).toBeFocused();
  });
});

test.describe("desktop comments escape handling (#314)", () => {
  test.use({ isMobile: false, hasTouch: false, viewport: { width: 1280, height: 900 } });

  test("Escape in desktop card view closes comments and restores focus to card comment button", async ({ page, context }) => {
    await setupBoard(page, context, "Desktop card comment discussion", "Kort");

    const card = page.locator(".issue-card").first();
    const commentBtn = card.locator(".comment-count");
    await expect(commentBtn).toBeVisible();

    await commentBtn.click();
    const commentsDialog = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
    await expect(commentsDialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(commentsDialog).not.toBeVisible();
    await expect(commentBtn).toBeFocused();
  });

  test("Escape in desktop expanded list row closes comments and keeps row expanded", async ({ page, context }) => {
    await setupBoard(page, context, "Desktop list comment discussion", "Lista");

    const row = page.locator(".issue-row").first();
    const rowTitle = row.locator(".row-title");
    await rowTitle.click();

    const rowCard = row.locator(".row-card");
    await expect(rowCard).toBeVisible();

    const commentBtn = rowCard.locator(".comment-count");
    await expect(commentBtn).toBeVisible();

    await commentBtn.click();
    const commentsDialog = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
    await expect(commentsDialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(commentsDialog).not.toBeVisible();
    await expect(commentBtn).toBeFocused();
    await expect(rowCard).toBeVisible();
    await expect(rowTitle).toHaveAttribute("aria-expanded", "true");
  });
});
