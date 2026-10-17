import { expect, test, type Page } from "@playwright/test";

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

// Returns, per summary card, how far each content part's centre deviates from the card's centre,
// and how far each bottom cell's text centre deviates from its own cell centre (#152).
function offsets(page: Page) {
  return page.locator(".stats .stat").evaluateAll(cards => cards.map(card => {
    const box = card.getBoundingClientRect();
    const centre = box.left + box.width / 2;
    const contentCentre = (element: Element, target = centre) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return rect.left + rect.width / 2 - target;
    };
    const parts = [".stat-icon", ".stat-label", "strong"]
      .map(selector => card.querySelector(selector)).filter((element): element is Element => !!element);
    const cellsBox = card.querySelector(".stat-cells")?.getBoundingClientRect();
    const cellOffsets = [...card.querySelectorAll(".stat-cell")].map(cell => {
      const cellBox = cell.getBoundingClientRect();
      return contentCentre(cell, cellBox.left + cellBox.width / 2);
    });
    return {
      parts: parts.length + (cellsBox ? 1 : 0),
      cells: cellOffsets.length,
      offsets: [
        ...parts.map(part => contentCentre(part)),
        ...(cellsBox ? [cellsBox.left + cellsBox.width / 2 - centre] : []),
        ...cellOffsets,
      ],
      right: box.right,
    };
  }));
}

async function expectCentred(page: Page) {
  const cards = await offsets(page);
  expect(cards).toHaveLength(4);
  for (const card of cards) {
    expect(card.parts).toBe(4);
    expect(card.cells).toBe(2);
    for (const offset of card.offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(2);
    expect(card.right).toBeLessThanOrEqual(375);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
}

test("summary cards centre icon, label, number and notes on phones in both languages", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await connect(page);
  await expect(page.locator('.stats [data-stat="closed"] .stat-today')).toContainText("+1 idag");
  await expect(page.locator(".repository-stat .stat-icon")).toBeVisible();
  await expectCentred(page);

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

  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator('.stats [data-stat="closed"] .stat-today')).toContainText("+1 today");
  await expect(card.getByRole("button", { name: "Choose repositories", exact: true })).toBeVisible();
  await expectCentred(page);
});
