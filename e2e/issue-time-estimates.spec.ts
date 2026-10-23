import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

const minute = 60000, day = 86400000;
const base = Date.parse("2026-10-15T10:00:00Z");
const repo = { id: 213, name: "issue-time", full_name: "sample/issue-time", private: true, html_url: "https://github.com/sample/issue-time", owner: { login: "sample" } };
const iso = (at: number) => new Date(at).toISOString();
async function fixture(page: Page, at = base, expiry = false) {
  const issues = Array.from({ length: 8 }, (_, i) => {
    const number = i + 1, closed = number <= 3;
    const closedAt = expiry ? base - 30 * day + 1000 : base - number * day;
    return { id: number, number, title: `Timing ${number}`, body: "", comments: 0, state: closed ? "closed" : "open",
      labels: number >= 5 ? [{ name: "in-progress", color: "000000" }] : [], assignees: number === 5 ? [1, 2, 3].map(id => ({ login: `person-${id}`, avatar_url: "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2722%27 height=%2722%27%3E%3Crect width=%2722%27 height=%2722%27 fill=%27%23678083%27/%3E%3C/svg%3E" })) : [],
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
  // Freeze setup so near-expiry samples do not age out while login is rendered.
  await page.clock.install({ time: at - minute });
  await page.clock.pauseAt(at);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-time-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
}
const badge = (page: Page, selector: string, number: number) => page.locator(selector).filter({ hasText: `Timing ${number}` }).locator(".issue-points");

test("individual timing follows repository history in cards, rows, combined view and phone popup", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  const activeCard = page.locator(".issue-card").filter({ hasText: "Timing 5" });
  const bar = activeCard.getByRole("progressbar");
  await expect(activeCard.locator(".issue-time-remaining-label")).toHaveText("≈ 20 min kvar");
  await expect(bar).toHaveAttribute("aria-valuenow", "33");
  await expect(bar).toHaveAttribute("aria-label", "Förfluten andel av uppskattad tid");
  await expect(bar).toHaveAttribute("aria-valuetext", /Uppskattad tid: ≈ 30 min.*Uppskattad tid kvar: ≈ 20 min/);
  await expect(activeCard.locator(".assignees img")).toHaveCount(3);
  await expect(activeCard.locator(".assignees img").first()).toBeVisible();
  const footerPosition = await activeCard.evaluate(card => {
    const footer = card.querySelector(".card-bottom")!.getBoundingClientRect();
    const progress = card.querySelector(".issue-time-progress")!.getBoundingClientRect();
    const timer = card.querySelector(".timer")!.getBoundingClientRect();
    return progress.x >= timer.right && Math.abs(progress.right - footer.right) < 1 && progress.bottom <= footer.bottom;
  });
  expect(footerPosition).toBe(true);
  await activeCard.screenshot({ path: testInfo.outputPath("card-desktop.png") });
  await page.setViewportSize({ width: 320, height: 844 });
  await activeCard.screenshot({ path: testInfo.outputPath("card-mobile320-board.png") });
  expect(await activeCard.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(activeCard.locator(".issue-time-remaining-label")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".issue-card").filter({ hasText: "Timing 6" }).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  for (const number of [4, 7, 8]) await expect(page.locator(".issue-card").filter({ hasText: `Timing ${number}` }).locator(".issue-time-remaining")).toHaveCount(0);
  const expected = /Uppskattad tid: ≈ 30 min\. Uppskattad tid kvar: ≈ 20 min/;
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("title", expected);
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("aria-label", expected);
  await expect(badge(page, ".issue-card", 6)).toHaveAttribute("title", /Uppskattad tid kvar: över uppskattning/);
  const overdueCard = page.locator(".issue-card").filter({ hasText: "Timing 6" });
  await expect(overdueCard.locator(".issue-time-remaining")).toHaveAttribute("title", /Övertid: 10 min över uppskattningen på ≈ 30 min/);
  await expect(overdueCard.locator(".issue-time-remaining-label"))
    .toHaveText("10 min ↑");
  for (const number of [4, 7, 8]) {
    await expect(badge(page, ".issue-card", number)).toHaveAttribute("title", /Uppskattad tid: ≈ 30 min/);
    await expect(badge(page, ".issue-card", number)).not.toHaveAttribute("title", /Uppskattad tid kvar/);
  }
  await page.clock.fastForward(5 * minute);
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
  await expect(bar).toHaveAttribute("aria-valuenow", "50");
  await expect(activeCard.locator(".issue-time-remaining-label")).toHaveText("≈ 15 min kvar");
  await mode.getByRole("button", { name: "Lista", exact: true }).click();
  for (const split of [true, false]) {
    if (!split) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    await expect(badge(page, ".issue-row", 5)).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
    const row = page.locator(".issue-row").filter({ hasText: "Timing 5" });
    const spent = await row.locator(".row-time > .timer").boundingBox();
    const remaining = await row.locator(".row-outcome > .issue-time-remaining").boundingBox();
    expect(remaining!.x).toBeGreaterThan(spent!.x + spent!.width);
    expect(Math.abs(remaining!.y - spent!.y)).toBeLessThan(5);
    await expect(row.locator(".issue-time-remaining-label")).toHaveText("≈ 15 min kvar");
    if (split) {
      const reference = await row.locator(".issue-time-remaining-label").evaluate(element => {
        const style = getComputedStyle(element);
        return { fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle, lineHeight: style.lineHeight };
      });
      for (const selector of [".issue-time-estimate", ".implementation-time"]) {
        const actual = await page.locator(`.issue-row ${selector}`).first().evaluate(element => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle, lineHeight: style.lineHeight };
        });
        expect(actual).toEqual(reference);
      }
    }
    await expect(row.getByRole("progressbar")).toHaveCount(0);
    await row.screenshot({ path: testInfo.outputPath("list-desktop.png") });
    await row.locator(".row-title").click();
    await expect(row.locator(".issue-points")).toHaveCount(1);
    await row.locator(".row-title").click();
  }
  await mode.getByRole("button", { name: "Kort", exact: true }).click();
  await expect(badge(page, ".issue-card", 5)).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
  await mode.getByRole("button", { name: "Lista", exact: true }).click();
  for (const width of [1100, 950, 850, 650, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const row = page.locator(".issue-row").filter({ hasText: "Timing 5" });
    expect(await row.locator(".row-title").evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(100);
    expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const spent = await row.locator(".row-time > .timer").boundingBox();
    const left = await row.locator(".row-outcome > .issue-time-remaining").boundingBox();
    expect(left!.x).toBeGreaterThan(spent!.x + spent!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator(".issue-row").filter({ hasText: "Timing 5" }).screenshot({ path: testInfo.outputPath("list-mobile.png") });
  await page.locator(".issue-row").filter({ hasText: "Timing 5" }).locator(".row-title").click();
  await expect(page.getByRole("dialog").locator(".issue-points")).toHaveAttribute("title", /Uppskattad tid kvar: ≈ 15 min/);
  await expect(page.getByRole("dialog").locator(".issue-points")).toHaveText("≈ 1 SP");
  await expect(page.getByRole("dialog").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await expect(page.getByRole("dialog").locator(".issue-time-remaining-label")).toHaveText("≈ 15 min kvar");
  await expect(page.getByRole("dialog").locator(".assignees img")).toHaveCount(3);
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole("dialog").locator(".issue-card").screenshot({ path: testInfo.outputPath("card-mobile320.png") });
  await page.clock.fastForward(14 * minute);
  await expect(page.getByRole("dialog").locator(".issue-time-remaining-label")).toHaveText("≈ 1 min kvar");
  await expect(page.getByRole("dialog").locator(".issue-time-remaining-label")).not.toContainText("↑");
  await page.clock.fastForward(2 * minute);
  await expect(page.getByRole("dialog").locator(".issue-time-remaining")).toHaveAttribute("title", /Övertid: 1 min över uppskattningen på ≈ 30 min/);
  await expect(page.getByRole("dialog").locator(".issue-time-remaining-label")).toHaveText("1 min ↑");
  await expect(page.getByRole("dialog").locator(".issue-time-remaining-label")).toHaveAttribute("aria-label", /Faktisk arbetstid hittills: ≈ 31 min.*Övertid: 1 min över uppskattningen/);
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByRole("dialog").locator(".issue-card").screenshot({ path: testInfo.outputPath("card-mobile320-overtime.png") });
  await expect(page.getByRole("dialog").getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(badge(page, ".issue-row", 5)).toHaveAttribute("aria-label", /Estimated time: ≈ 30 min[.] Estimated time remaining: over estimate[.] Based on median time per point from 3 usable closures/);
  await expect(page.locator(".issue-row").filter({ hasText: "Timing 5" }).locator(".issue-time-remaining-label")).toHaveText("1 min ↑");
  await expect(page.locator(".issue-row").filter({ hasText: "Timing 5" }).locator(".issue-time-remaining-label"))
    .toHaveAttribute("aria-label", /Actual work time so far: ≈ 31 min.*Overtime: 1 min beyond the estimate/);
  await page.getByRole("group", { name: "Board view mode", exact: true }).getByRole("button", { name: "Cards", exact: true }).click();
  await expect(page.locator(".issue-card").filter({ hasText: "Timing 5" }).getByRole("progressbar", { name: "Elapsed share of estimated time" }))
    .toHaveAttribute("aria-valuetext", /Actual work time so far: ≈ 31 min.*Overtime: 1 min beyond the estimate/);
});

test("individual tooltip loses its duration when history expires without new data", async ({ page }) => {
  await fixture(page, base, true);
  const point = badge(page, ".issue-card", 4);
  await expect(point).toHaveAttribute("title", /Uppskattad tid: ≈ 30 min/);
  await expect(page.locator(".issue-card").filter({ hasText: "Timing 5" }).locator(".issue-time-remaining")).toBeVisible();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  await page.route(url => url.hostname === "api.github.com" && url.pathname.endsWith("/issues"), route => route.abort());
  await page.clock.fastForward(2000);
  await expect(point).not.toHaveAttribute("title", /Uppskattad tid:/);
  await expect(point).toHaveText("≈ 1 SP");
  await expect(page.locator(".issue-time-remaining")).toHaveCount(0);
});


test("issue time calibration follows repository filters and ignores them on combined boards", async ({ page }) => {
  await fixture(page);
  const point = () => badge(page, ".issue-card", 5);
  await expect(point()).toHaveAttribute("title", /Uppskattad tid:/);
  await page.getByRole("textbox", { name: `Filtrera issues i ${repo.full_name}`, exact: true }).fill("#5");
  await expect(point()).not.toHaveAttribute("title", /Uppskattad tid:/);
  await expect(page.locator(".issue-time-remaining")).toHaveCount(0);
  await expect(page.locator(".column-estimate")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  await expect(point()).toHaveAttribute("title", /Uppskattad tid: ≈ 30 min/);
  await expect(page.locator(".column-estimate").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("#5");
  await expect(point()).not.toHaveAttribute("title", /Uppskattad tid:/);
  await expect(page.locator(".issue-time-remaining")).toHaveCount(0);
});
