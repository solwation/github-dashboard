import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const repo = { id: 185, name: "list-comments", full_name: "sample/list-comments", description: "Fictional list comments fixture", private: true, html_url: "https://github.com/sample/list-comments", owner: { login: "sample" } };
  const old = new Date(Date.now() - 86400000).toISOString();
  const counts = [7, 0]; let updatedAt = old;
  const requests: number[] = [];
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "list-comments-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/comments")) {
      const number = Number(url.pathname.split("/").at(-2)); requests.push(number);
      return route.fulfill({ json: number === 1 ? [{ id: 1, body: "Discussion opened directly from the list", html_url: `${repo.html_url}/issues/1#issuecomment-1`, created_at: old, user: { login: "fixture-author" } }] : [] });
    }
    if (url.pathname.endsWith("/issues")) {
      const issues = counts.map((comments, index) => ({ id: index + 1, number: index + 1, title: index === 0 ? "Discussed task with a deliberately long title that retains its own expansion action" : "Other task", comments, body: "Row details stay independent from comments.", state: "open", created_at: old, updated_at: updatedAt, closed_at: null, html_url: `${repo.html_url}/issues/${index + 1}`, assignees: [], labels: [{ name: "enhancement", color: "a2eeef" }] }));
      return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : issues });
    }
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-list-comments-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator(".issue-row")).toHaveCount(2);
  return { requests, addComments() { counts[0] = 9; counts[1] = 1; updatedAt = new Date().toISOString(); } };
}

test("wide list rows show correct counts and reuse the comments dialog without expanding or reading another row", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const api = await fixture(page);
  const row = page.locator(".issue-row").first(), other = page.locator(".issue-row").nth(1);
  await expect(row.locator(".row-comments").getByRole("button", { name: "7 kommentarer", exact: true })).toBeVisible();
  await expect(other.locator(".row-comments").getByRole("button", { name: "0 kommentarer", exact: true })).toBeVisible();
  expect(api.requests).toEqual([]);
  api.addComments(); await page.keyboard.press("Control+r");
  await expect(row.locator(".row-comment-marker")).toContainText("+2");
  await expect(other.locator(".row-comment-marker")).toContainText("+1");
  const comments = row.locator(".row-comments .comment-count");
  await expect(comments).toHaveAccessibleName("9 kommentarer, 2 nya");
  await comments.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
  await expect(dialog.getByText("Discussion opened directly from the list", { exact: true })).toBeVisible();
  await expect(row.locator(".row-title")).toHaveAttribute("aria-expanded", "false");
  await expect(row.locator(".row-card")).toHaveCount(0);
  await expect(other.locator(".row-comment-marker")).toBeVisible();
  await dialog.getByRole("button", { name: "Stäng kommentarer", exact: true }).click();
  await expect(comments).toBeFocused();
  expect(api.requests).toEqual([1]);
  const [commentBounds, rowBounds, timeBounds] = await Promise.all([comments.boundingBox(), row.boundingBox(), row.locator(".row-time").boundingBox()]);
  expect(commentBounds!.x + commentBounds!.width).toBeLessThanOrEqual(timeBounds!.x);
  expect(commentBounds!.x).toBeGreaterThanOrEqual(rowBounds!.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The expanded desktop card continues to offer the same comments action.
  await row.locator(".row-title").click();
  await expect(row.locator(".row-card")).toBeVisible();
});

test("narrow rows keep comments in the phone detail card and fit without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  const api = await fixture(page);
  const row = page.locator(".issue-row").first();
  await expect(row.locator(".row-comments")).not.toBeVisible();
  expect(api.requests).toEqual([]);
  await row.locator(".row-title").click();
  const cardDialog = page.getByRole("dialog", { name: /^Discussed task/ });
  await expect(cardDialog).toBeVisible();
  await cardDialog.getByRole("button", { name: "7 kommentarer", exact: true }).click();
  const commentsDialog = page.getByRole("dialog", { name: "Kommentarer för #1", exact: true });
  await expect(commentsDialog.getByText("Discussion opened directly from the list", { exact: true })).toBeVisible();
  await commentsDialog.getByRole("button", { name: "Stäng kommentarer", exact: true }).click();
  await expect(cardDialog).toBeVisible();
  await cardDialog.getByRole("button", { name: "Stäng", exact: true }).click();
  await expect(row.locator(".row-title")).toHaveAttribute("aria-expanded", "false");
  for (const width of [320, 375, 650, 950, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  await expect(page.locator(".combined-board .row-comments").first().getByRole("button", { name: "7 kommentarer", exact: true })).toBeVisible();
});
