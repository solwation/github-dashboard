import { expect, test } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

test("new Backlog issues are green, persist through sync and comments, and acknowledge separately from returns", async ({ page }) => {
  await page.clock.install();
  async function refresh() {
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    await page.keyboard.press("F5");
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  }
  let createdAt = "";
  let version = 0;
  const old = new Date(Date.now() - 86400000).toISOString();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "backlog-created-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = [{ id: 1, name: "test", full_name: "sample/test", private: false, html_url: "https://github.com/sample/test", owner: { login: "sample" } }];
    else if (url.pathname.endsWith("/issues")) {
      data = [
        { id: 1, number: 1, title: "Returning work", state: "open", created_at: old, updated_at: version >= 2 ? createdAt : old, labels: version >= 2 ? [] : [{ name: "in-progress", color: "000000" }] },
        ...(createdAt ? [{ id: 2, number: 2, title: "Fresh backlog item", state: "open", created_at: createdAt, updated_at: version >= 3 ? new Date(Date.parse(createdAt) + 1000).toISOString() : createdAt, labels: [] }] : []),
      ].map(issue => ({ ...issue, html_url: "https://github.com/sample/test/issues/" + issue.number, closed_at: null, assignees: [], comments: 0, body: "Fictional fixture" }))
        .filter(() => url.searchParams.get("state") !== "closed");
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-created-marker-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/test" }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".unread-created")).toHaveCount(0);
  await page.clock.fastForward(2000);
  createdAt = await page.evaluate(() => new Date().toISOString());
  version = 1;
  await refresh();
  const fresh = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Fresh backlog item", exact: true }) });
  await expect(fresh).toHaveClass(/unread-created/);
  await expect(fresh.getByRole("button", { name: "Nyligen skapat i Backlog. Markera som läst", exact: true })).toContainText("Skapat i Backlog");
  const green = await fresh.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(green).toBe("rgb(237, 248, 240)");
  await refresh();
  await expect(fresh).toHaveClass(/unread-created/);
  await page.clock.fastForward(1000);
  version = 3;
  await refresh();
  await expect(fresh).toHaveClass(/unread-created/);
  const returning = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Returning work", exact: true }) });
  await expect(returning).toHaveClass(/unread-move/);
  await expect(returning).not.toHaveClass(/unread-created/);
  await expect(returning.getByRole("button", { name: "Nyligen flyttad. Markera som läst", exact: true })).toContainText("Flyttad till Backlog");
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("Fresh");
  await expect(fresh).toHaveClass(/unread-created/);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(fresh.getByRole("button", { name: "Recently created in Backlog. Mark as read", exact: true })).toContainText("Created in backlog");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await fresh.getByRole("button", { name: "Recently created in Backlog. Mark as read", exact: true }).click();
  await expect(fresh).not.toHaveClass(/unread-created/);
  await refresh();
  await expect(fresh).not.toHaveClass(/unread-created/);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".unread-created")).toHaveCount(0);
});
