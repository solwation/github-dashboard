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

// Preserve #338's responsive alignment and whole-field wrapping with the restored hierarchy.
async function expectStructuredSummary(page: Page) {
  const cards = await page.locator(".stats .stat").evaluateAll(items => items.map(card => {
    const box = card.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    const parts = [".stat-icon", ".stat-label", "strong", ".overview-estimate", ".stat-cells"]
      .map(selector => card.querySelector(selector)!.getBoundingClientRect());
    return {
      right: box.right,
      height: box.height,
      offsets: parts.map(rect => rect.left + rect.width / 2 - centre),
      footerBorder: getComputedStyle(card.querySelector(".stat-cells")!).borderTopWidth,
      font: getComputedStyle(card.querySelector("strong")!).fontSize,
    };
  }));
  expect(cards).toHaveLength(4);
  for (const card of cards) {
    expect(card.height).toBeGreaterThan(140);
    expect(card.right).toBeLessThanOrEqual(375);
    expect(card.font).toBe("27px");
    expect(card.footerBorder).toBe("1px");
    for (const offset of card.offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
}

test("summary cards restore grouped labels, figures, estimates and footers on phones in both languages", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await connect(page);
  await expect(page.locator('.stats [data-stat="closed"] .stat-today')).toContainText("+1 idag");
  await expect(page.locator(".repository-stat .stat-icon")).toBeVisible();
  await expectStructuredSummary(page);

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
  await expectStructuredSummary(page);
});
