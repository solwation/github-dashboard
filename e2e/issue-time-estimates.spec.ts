import { expect, test, type Page } from "@playwright/test";

const minute = 60000, day = 86400000;
const base = Date.parse("2026-10-15T10:00:00Z");
const repo = { id: 213, name: "issue-time", full_name: "sample/issue-time", private: true, html_url: "https://github.com/sample/issue-time", owner: { login: "sample" } };
const iso = (at: number) => new Date(at).toISOString();
async function fixture(page: Page, at = base, expiry = false) {
  const issues = Array.from({ length: 8 }, (_, i) => {
    const number = i + 1, closed = number <= 3;
    const closedAt = expiry ? base - 30 * day + 1000 : base - number * day;
    return { id: number, number, title: `Timing ${number}`, body: "", comments: 0, state: closed ? "closed" : "open",
      labels: number >= 5 ? [{ name: "in-progress", color: "000000" }] : [], assignees: [],
      created_at: iso(base - 35 * day), updated_at: iso(base - day),
      startedAt: closed ? iso(closedAt - 30 * minute) : undefined,
      closed_at: closed ? iso(closedAt) : null, html_url: `${repo.html_url}/issues/${number}` };
  });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    const number = Number(event?.[1]);
    const start = number === 5 ? base - 10 * minute : number === 6 ? base - 40 * minute : number === 8 ? base + day : null;
    await route.fulfill({ json: url.pathname === "/user" ? { login: "time-fixture", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo]
      : event ? (start === null ? [] : [{ id: number, event: "labeled", label: { name: "in-progress" }, created_at: iso(start) }])
      : url.pathname.endsWith("/issues") ? issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.clock.install({ time: at });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-time-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
}
const badge = (page: Page, selector: string, number: number) => page.locator(selector).filter({ hasText: `Timing ${number}` }).locator(".issue-points");

test("individual timing follows repository history in cards, rows, combined view and phone popup", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  const expected = /Uppskattad tid: ≈ 30 min\. Uppskattad tid kvar: ≈ 20 min/;
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("title", expected);
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("aria-label", expected);
  await expect(badge(page, ".issue-card", 6)).toHaveAttribute("title", /Uppskattad tid kvar: över uppskattning/);
  for (const number of [4, 7, 8]) {
    await expect(badge(page, ".issue-card", number)).toHaveAttribute("title", /Uppskattad tid: ≈ 30 min/);
    await expect(badge(page, ".issue-card", number)).not.toHaveAttribute("title", /Uppskattad tid kvar/);
  }
  await page.clock.fastForward(5 * minute);
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
  await mode.getByRole("button", { name: "Lista", exact: true }).click();
  for (const split of [true, false]) {
    if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    await expect(badge(page, ".issue-row", 5)).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
    const row = page.locator(".issue-row").filter({ hasText: "Timing 5" });
    await row.locator(".row-title").click();
    await expect(row.locator(".issue-points")).toHaveCount(1);
    await row.locator(".row-title").click();
  }
  await mode.getByRole("button", { name: "Kort", exact: true }).click();
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
  await mode.getByRole("button", { name: "Lista", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".issue-row").filter({ hasText: "Timing 5" }).locator(".row-title").click();
  await expect(page.getByRole("dialog").locator(".issue-points")).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
  await expect(page.getByRole("dialog").locator(".issue-points")).toHaveText("≈ 1 SP");
  await page.clock.fastForward(16 * minute);
  await expect(page.getByRole("dialog").locator(".issue-points")).toHaveAttribute("title", /Uppskattad tid kvar: över uppskattning/);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(badge(page, ".issue-row", 5)).toHaveAttribute("aria-label", /Estimated time: ≈ 30 min[.] Estimated time remaining: over estimate[.] Based on median time per point from 3 usable closures/);
});

test("individual tooltip loses its duration when history expires without new data", async ({ page }) => {
  await fixture(page, base, true);
  const point = badge(page, ".issue-card", 4);
  await expect(point).toHaveAttribute("title", /Uppskattad tid: ≈ 30 min/);
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  await page.route(url => url.hostname === "api.github.com" && url.pathname.endsWith("/issues"), route => route.abort());
  await page.clock.fastForward(2000);
  await expect(point).not.toHaveAttribute("title", /Uppskattad tid:/);
  await expect(point).toHaveText("≈ 1 SP");
});


test("issue time calibration follows repository filters and ignores them on combined boards", async ({ page }) => {
  await fixture(page);
  const point = () => badge(page, ".issue-card", 5);
  await expect(point()).toHaveAttribute("title", /Uppskattad tid:/);
  await page.getByRole("textbox", { name: `Filtrera issues i ${repo.full_name}`, exact: true }).fill("#5");
  await expect(point()).not.toHaveAttribute("title", /Uppskattad tid:/);
  await expect(page.locator(".column-estimate")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  await expect(point()).toHaveAttribute("title", /Uppskattad tid: ≈ 30 min/);
  await expect(page.locator(".column-estimate").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("#5");
  await expect(point()).not.toHaveAttribute("title", /Uppskattad tid:/);
});
