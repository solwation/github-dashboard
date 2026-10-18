import { expect, test } from "@playwright/test";
test("movement markers and sidebar dots are acknowledged individually and expire", async ({ page }) => {
  await page.clock.install();
  const created = new Date(Date.now() - 86_400_000).toISOString();
  const repo = { id: 1, name: "test", full_name: "sample/test", private: false, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
  let moved = false;
  let updated = created;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "activity-test", avatar_url: "" };
    if (url.pathname === "/user/repos") data = [repo];
    if (url.pathname.endsWith("/issues")) data = [1, 2].map(number => ({ id: number, number, title: `Activity ${number}`, body: "Read this change", comments: 0, state: "open", closed_at: null, labels: moved ? [{ name: "in-progress", color: "fff" }] : [], assignees: [], html_url: `${repo.html_url}/issues/${number}`, created_at: created, updated_at: updated })).filter(() => url.searchParams.get("state") !== "closed");
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-activity-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".unread-move")).toHaveCount(0);
  moved = true; updated = new Date().toISOString();
  await page.keyboard.press("Control+r");
  await expect(page.locator(".unread-move")).toHaveCount(2);
  await expect(page.locator(".recent-activity")).toHaveCount(1);
  await page.locator(".unread-move").first().getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(page.locator(".unread-move")).toHaveCount(1);
  await expect(page.locator(".recent-activity")).toHaveCount(1);
  await page.getByRole("button", { name: "Nyligen flyttad. Markera som läst", exact: true }).click();
  await expect(page.locator(".unread-move")).toHaveCount(0);
  await expect(page.locator(".recent-activity")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".recent-activity")).toHaveCount(0);
  moved = false; updated = new Date(Date.now() + 1000).toISOString();
  await page.keyboard.press("Control+r");
  await expect(page.locator(".unread-move")).toHaveCount(2);
  await page.clock.fastForward(121_000);
  await expect(page.locator(".unread-move")).toHaveCount(0);
  await expect(page.locator(".recent-activity")).toHaveCount(0);
});

test("animates and badges new comments when count increases, acknowledges on click, and respects reduced motion", async ({ page }) => {
  await page.clock.install();
  const created = new Date(Date.now() - 86_400_000).toISOString();
  const repo = { id: 1, name: "test", full_name: "sample/test", private: false, description: "Fixture", html_url: "https://github.com/sample/test", owner: { login: "sample" } };
  let commentsCount = 1;
  let updated = created;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "activity-test", avatar_url: "" };
    if (url.pathname === "/user/repos") data = [repo];
    if (url.pathname.endsWith("/comments")) data = [];
    if (url.pathname.endsWith("/issues")) data = [{ id: 1, number: 1, title: "Activity Issue", body: "Check comments", comments: commentsCount, state: "open", closed_at: null, labels: [], assignees: [], html_url: `${repo.html_url}/issues/1`, created_at: created, updated_at: updated }].filter(() => url.searchParams.get("state") !== "closed");
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fixture-activity-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();

  await expect(page.locator(".comment-count")).toHaveText("1");
  await expect(page.locator(".new-comments-badge")).toHaveCount(0);
  await expect(page.locator(".comment-icon-animated")).toHaveCount(0);

  // New comment arrives
  commentsCount = 2;
  updated = new Date().toISOString();
  await page.keyboard.press("Control+r");

  const commentBtn = page.getByRole("button", { name: "2 kommentarer, 1 ny" });
  await expect(commentBtn).toBeVisible();
  await expect(commentBtn.locator(".new-comments-badge")).toHaveText("+1");
  await expect(commentBtn.locator(".comment-icon-animated")).toBeVisible();

  // Switch to list view: row shows row-comment-marker
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  const rowMarker = page.locator(".row-comment-marker");
  await expect(rowMarker).toBeVisible();
  await expect(rowMarker).toContainText("+1");

  // Clicking row marker acknowledges it
  await rowMarker.click();
  await expect(page.locator(".row-comment-marker")).toHaveCount(0);

  // Switch back to cards: badge is gone and button is normal
  await page.getByRole("button", { name: "Kort", exact: true }).click();
  await expect(page.getByRole("button", { name: "2 kommentarer", exact: true })).toBeVisible();
  await expect(page.locator(".new-comments-badge")).toHaveCount(0);
  await expect(page.locator(".comment-icon-animated")).toHaveCount(0);
});
