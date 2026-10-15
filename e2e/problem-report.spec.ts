import { expect, test, type Page } from "@playwright/test";
async function openReport(page: Page) {
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByRole("button", { name: /^Problemrapport/ }).click();
}

async function setup(page: Page) {
  let healthy = false;
  let commitRequests = 0;
  const closedAt = new Date().toISOString();
  const repo = { id: 1, name: "test", full_name: "sample/test", private: true, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/graphql") {
      commitRequests++;
      if (!healthy) { await route.fulfill({ status: 403, json: { message: "Forbidden" } }); return; }
      const number = route.request().postDataJSON().variables.number;
      await route.fulfill({ json: { data: { repository: { issue: { state: "CLOSED", closedAt, timelineItems: { nodes: [{ createdAt: closedAt, closer: { __typename: "Commit", oid: "abc12345678", url: "https://github.com/sample/test/commit/abc12345678", additions: number, deletions: 2 } }] } } } } } }); return;
    }
    await route.fulfill({ json: url.pathname === "/user" ? { login: "report-test", avatar_url: "" } : url.pathname === "/user/repos" ? [repo] : url.pathname.endsWith("/issues") && url.searchParams.get("state") === "closed" ? [1, 2, 3].map(number => ({ id: number, number, title: `Issue ${number}`, state: "closed", closed_at: closedAt, created_at: closedAt, updated_at: closedAt, html_url: `https://github.com/sample/test/issues/${number}`, labels: [], assignees: [], comments: 0 })) : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-report-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await page.locator(".issue-card.closed").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".commit-notice")).toContainText("3 issues");
  return { recover() { healthy = true; }, requests() { return commitRequests; } };
}

test("groups repeated failures, preserves report after hiding and remembers the preference", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await setup(page);
  await expect(page.locator(".commit-notice")).toHaveCount(1);
  await expect(page.locator(".issue-card")).not.toContainText(["Stängande commit kunde inte hämtas.", "Contents och Pull requests"]);
  await page.locator(".commit-notice").getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toContainText("Contents och Pull requests");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await page.getByRole("button", { name: "Visa inte igen", exact: true }).click();
  await expect(page.locator(".commit-notice")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await page.locator(".issue-card.closed").last().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".problem-report li").count()).toBe(3);
  await expect(page.locator(".commit-notice")).toHaveCount(0);
  await openReport(page);
  await expect(page.getByRole("dialog").locator("li")).toHaveCount(3);
  await page.getByRole("checkbox", { name: "Visa notiser om problem med commit-information" }).check();
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await expect(page.locator(".commit-notice")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("retry clears recovered issues from the report and restores commit statistics", async ({ page }) => {
  const state = await setup(page);
  expect(state.requests()).toBe(3);
  await openReport(page);
  state.recover();
  await page.getByRole("button", { name: "Försök igen", exact: true }).click();
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await page.locator(".issue-card.closed").first().scrollIntoViewIfNeeded();
  await expect(page.locator(".issue-card.closed").first().locator(".commit-diff")).toHaveCount(1);
  await page.locator(".issue-card.closed").last().scrollIntoViewIfNeeded();
  await expect(page.locator(".commit-diff")).toHaveCount(3);
  await expect(page.locator(".commit-notice")).toHaveCount(0);
  await openReport(page);
  await expect(page.getByRole("dialog")).toContainText("Inga rapporterade problem");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await expect(page.getByRole("button", { name: "Problemrapport", exact: true })).toHaveCount(0);
});
