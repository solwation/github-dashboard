import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

async function connect(page: Page) {
  const repo = { id: 1, name: "alpha", full_name: "sample/alpha", private: false, html_url: "https://github.com/sample/alpha", owner: { login: "sample" } };
  const issue = (id: number, state: string, progress = false) => ({
    id, number: id, title: "Fixture " + id, state, body: "", comments: 0,
    labels: progress ? [{ name: "in-progress", color: "123456" }] : [], assignees: [],
    created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString(),
    closed_at: state === "closed" ? new Date().toISOString() : null,
    html_url: "https://github.com/sample/alpha/issues/" + id,
  });
  const issues = [issue(1, "open", true), issue(2, "open"), issue(3, "closed")];
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/user") body = { login: "layout-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") body = [repo];
    else if (url.pathname.endsWith("/issues")) body = issues.filter(item => item.state === url.searchParams.get("state"));
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => localStorage.setItem("issueflow:layout-fixture", JSON.stringify({ selected: ["sample/alpha"] })));
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-layout-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
}

// Verifies that summary cards render compactly on phones with consistent left alignment
// across all content parts, without page horizontal scroll (#152, #332, #338).
async function expectCompactSummary(page: Page) {
  const cards = await page.locator(".stats .stat").evaluateAll(items => items.map(card => {
    const box = card.getBoundingClientRect();
    const content = card.querySelector(".stat-content")?.getBoundingClientRect();
    const parts = [".stat-header", ".stat-cells"]
      .map(selector => card.querySelector(selector)?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => !!rect);
    return {
      right: box.right,
      height: box.height,
      contentLeft: content?.left ?? 0,
      partLefts: parts.map(p => p.left),
    };
  }));
  expect(cards).toHaveLength(4);
  for (const card of cards) {
    expect(card.height).toBeLessThanOrEqual(85);
    expect(card.right).toBeLessThanOrEqual(375);
    for (const left of card.partLefts) {
      expect(Math.abs(left - card.contentLeft)).toBeLessThanOrEqual(2);
    }
  }
  const summaryHeight = await page.locator(".stats").evaluate(el => el.getBoundingClientRect().height);
  expect(summaryHeight).toBeLessThanOrEqual(160);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
}

test("summary cards render compactly with consistent left alignment on phones in both languages", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await connect(page);
  await expect(page.locator('.stats [data-stat="closed"] .stat-today')).toContainText("+1 idag");
  await expect(page.locator(".repository-stat .stat-icon")).toBeVisible();
  await expectCompactSummary(page);

  const card = page.locator(".repository-stat");
  const action = card.getByRole("button", { name: "Välj repositories", exact: true });
  await expect(action).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const actionBox = (await action.boundingBox())!;
  const iconBox = (await card.locator(".stat-icon").boundingBox())!;
  expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(actionBox.x).toBeGreaterThanOrEqual(iconBox.x + iconBox.width);
  await action.focus();
  await expect(action).toBeFocused();

  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('.stats [data-stat="closed"] .stat-today')).toContainText("+1 today");
  await expect(card.getByRole("button", { name: "Choose repositories", exact: true })).toBeVisible();
  await expectCompactSummary(page);
});
