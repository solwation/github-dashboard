import { expect, test, type Locator, type Page } from "@playwright/test";

const repo = { id: 210, name: "points-fixture", full_name: "sample/points-fixture", private: true, description: "", html_url: "https://github.com/sample/points-fixture", owner: { login: "sample" } };
const specs = [
  { title: "Explicitly sized work", labels: ["story points: 13"], points: 13, state: "open" },
  { title: "Improve database security", labels: ["in-progress"], points: 3, state: "open" },
  { title: "Small wording adjustment", labels: [], points: 1, state: "closed" },
];
async function fixture(page: Page) {
  const time = new Date(Date.now() - 3600000).toISOString();
  const issues = specs.map((spec, i) => ({ id: i + 1, number: i + 1, title: spec.title, body: "", comments: 0, state: spec.state,
    labels: spec.labels.map(name => ({ name, color: "a2eeef" })), assignees: [], created_at: time, updated_at: time,
    closed_at: spec.state === "closed" ? time : null, html_url: `${repo.html_url}/issues/${i + 1}` }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.pathname === "/user" ? { login: "points-fixture", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo]
      : url.pathname.endsWith("/issues") ? issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-points-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
}
async function assertSizes(items: Locator) {
  await expect(items).toHaveCount(3);
  for (const spec of specs) {
    const badge = items.filter({ hasText: spec.title }).locator(".issue-points");
    await expect(badge).toHaveText(`≈ ${spec.points} SP`);
    await expect(badge).toHaveAttribute("aria-label", new RegExp(`^Uppskattade story points: cirka ${spec.points}[.]`));
    await expect(badge).toHaveAttribute("title", /En entydig poängetikett används först.*Inte uppmätt komplexitet/);
  }
}
async function fits(page: Page, badges: Locator) {
  for (const badge of await badges.all()) {
    await expect(badge).toBeVisible();
    expect(await badge.evaluate(element => {
      const box = element.getBoundingClientRect(), parent = element.closest(".issue-card, .issue-row")!.getBoundingClientRect();
      return box.left >= parent.left && box.right <= parent.right && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("cards and rows show explicit and heuristic sizes without timing history in split and combined boards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  for (const split of [true, false]) {
    if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    await mode.getByRole("button", { name: "Kort", exact: true }).click();
    await assertSizes(page.locator(".issue-card"));
    await fits(page, page.locator(".issue-card .issue-points"));
    await expect(page.locator(".column-estimate")).toHaveCount(0);
    await mode.getByRole("button", { name: "Lista", exact: true }).click();
    await assertSizes(page.locator(".issue-row"));
    const row = page.locator(".issue-row").filter({ hasText: specs[0]!.title });
    await row.locator(".row-title").click();
    await expect(row.locator(".row-details-card")).toBeVisible();
    await expect(row.locator(".issue-points")).toHaveCount(1);
    await row.locator(".row-title").click();
  }
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const badge = page.locator(".issue-row").filter({ hasText: specs[0]!.title }).locator(".issue-points");
  await expect(badge).toHaveAttribute("aria-label", /^Estimated story points: approximately 13\./);
  await expect(badge).toHaveAttribute("title", /An unambiguous points label takes precedence.*Not measured complexity/);
});

test("sizes fit phone cards and rows and appear on the full popup card", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await fixture(page);
  const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  for (const split of [true, false]) {
    if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await mode.getByRole("button", { name: "Kort", exact: true }).click();
      await assertSizes(page.locator(".issue-card"));
      await fits(page, page.locator(".issue-card .issue-points"));
      await mode.getByRole("button", { name: "Lista", exact: true }).click();
      await assertSizes(page.locator(".issue-row"));
      await fits(page, page.locator(".issue-row .issue-points"));
      await page.locator(".row-title").filter({ hasText: specs[0]!.title }).click();
      await expect(page.getByRole("dialog").locator(".issue-points")).toHaveText("≈ 13 SP");
      await fits(page, page.getByRole("dialog").locator(".issue-points"));
      await page.keyboard.press("Escape");
    }
  }
});
