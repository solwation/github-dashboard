import { expect, test } from "@playwright/test";

test("closing commit details appear only for available associations and survive issue refresh", async ({ page }) => {
  const repo = { id: 600, name: "optional-commits", full_name: "sample/optional-commits", description: "Fictional commit fixture", private: true, html_url: "https://github.com/sample/optional-commits", owner: { login: "sample" } };
  const closedAt = new Date().toISOString();
  const titles = ["Manual closure", "Unavailable commit", "Linked zero diff", "Linked without diff"];
  const issues = titles.map((title, index) => ({ id: index + 1, number: index + 1, title, state: "closed", created_at: closedAt, updated_at: closedAt, closed_at: closedAt, html_url: `${repo.html_url}/issues/${index + 1}`, labels: [], assignees: [] }));
  const loaded = new Set<number>();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "https://github.com/identicons/sample.png" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "open" ? [] : issues });
    if (url.pathname === "/graphql") {
      const number = (route.request().postDataJSON() as { variables: { number: number } }).variables.number;
      loaded.add(number);
      if (number === 2) return route.fulfill({ status: 403, json: { message: "Resource not accessible by personal access token" } });
      const closer = number === 1 ? null : { __typename: "Commit", oid: "abcdef123456789", url: `${repo.html_url}/commit/abcdef123456789`, ...(number === 3 ? { additions: 0, deletions: 0 } : {}) };
      return route.fulfill({ json: { data: { repository: { issue: { state: "CLOSED", closedAt, timelineItems: { nodes: [{ createdAt: closedAt, closer }] } } } } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-optional-commit-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: /sample\/optional-commits/ }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(4);
  for (const [index, title] of titles.entries()) {
    const card = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => loaded.has(index + 1)).toBe(true);
    if (index < 2) {
      await expect(card.locator(".closing-commit")).toHaveCount(0);
      await expect(card).not.toContainText(/Ingen stängande commit|No closing commit|kunde inte hämtas|not accessible/);
    } else {
      await expect(card.locator(".closing-commit a")).toHaveAttribute("href", `${repo.html_url}/commit/abcdef123456789`);
      if (index === 2) {
        await expect(card.locator(".additions")).toHaveText("+0");
        await expect(card.locator(".deletions")).toHaveText("−0");
      } else await expect(card.locator(".commit-diff")).toHaveCount(0);
    }
  }
  // A normal data refresh replaces issue objects but should keep existing metadata visible.
  const linked = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Linked zero diff", exact: true }) });
  await linked.scrollIntoViewIfNeeded();
  await linked.evaluate(element => {
    const state = { loadingFlashes: 0 };
    Object.assign(window, { closingCommitRefresh: state });
    new MutationObserver(() => {
      if (element.querySelector(".closing-commit")?.textContent?.includes("Hämtar stängande commit")) state.loadingFlashes++;
    }).observe(element, { childList: true, characterData: true, subtree: true });
  });
  await page.keyboard.press("Control+r");
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  await expect(linked.locator(".closing-commit a")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { closingCommitRefresh: { loadingFlashes: number } }).closingCommitRefresh.loadingFlashes)).toBe(0);
  await expect(page.locator(".issue-card")).toHaveCount(4);
});
