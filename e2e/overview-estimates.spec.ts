import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";
const minute = 60000, day = 86400000, base = Date.parse("2026-10-20T12:00:00Z");
const iso = (at: number) => new Date(at).toISOString();
const repos = ["calibrated", "sparse"].map((name, i) => ({ id: 2190 + i, name, full_name: `sample/${name}`, private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
async function fixture(page: Page, expiry = false, futureStart = false) {
  const issues = (repo: typeof repos[number]) => {
    const item = (number: number, points: number, progress = false, closed = false) => {
      const end = expiry ? base - 30 * day + 1000 : base - number * day;
      return { id: repo.id * 100 + number, number, title: `Work ${number}`, body: "", comments: 0,
        state: closed ? "closed" : "open", labels: [{ name: `points: ${points}`, color: "000000" }, ...(progress ? [{ name: "in-progress", color: "000000" }] : [])], assignees: [],
        created_at: iso(base - 5 * day), updated_at: iso(base - day), closed_at: closed ? iso(end) : null,
        workStartedAt: closed ? iso(end - 30 * minute) : undefined, html_url: `${repo.html_url}/issues/${number}` };
    };
    return repo.id === repos[0]!.id ? [item(1, 1, false, true), item(2, 1, false, true), item(3, 1, false, true), item(4, 2), item(5, 3),
      { ...item(8, 13), labels: [{ name: "orkester", color: "" }, { name: "points: 13", color: "" }] }].map(issue => issue.number === 5 ? { ...issue, labels: [...issue.labels, { name: "in-progress", color: "" }] } : issue)
      : [item(4, 5), item(6, 1, true)];
  };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    await route.fulfill({ json: url.pathname === "/user" ? { login: "overview-estimate-fixture", avatar_url: "" }
      : url.pathname === "/user/repos" ? repos
      : repo && event ? [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: iso(futureStart && repo.id === repos[0]!.id ? base + minute : base - 10 * minute) }]
      : repo && url.pathname.endsWith("/issues") ? issues(repo).filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.clock.install({ time: base - minute });
  await page.clock.pauseAt(base);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-overview-estimates-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
}
const tile = (page: Page, key: "open" | "progress") => page.locator(`.stats [data-stat="${key}"]`);

test("summary estimates share the count scope, disclose partial time coverage, update locally and fit phones", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixture(page);
  const open = tile(page, "open"), progress = tile(page, "progress");
  await expect(open.locator("strong")).toHaveText(/4/);
  await expect(progress.locator("strong")).toHaveText(/2/);
  await expect(open.locator(".overview-points")).toHaveText("≈ 11 SP");
  await expect(progress.locator(".overview-points")).toHaveText("≈ 4 SP");
  await expect(open.locator(".overview-time")).toHaveText("≈ 2 h 20 min kvar");
  await expect(progress.locator(".overview-time")).toHaveText("≈ 1 h 20 min kvar");
  await expect(open.locator(".overview-coverage")).toHaveText("Tid för 1 av 2 repos");
  await expect(open.locator(".overview-estimate")).toHaveAttribute("aria-label", /cirka 11.*samma filtrerade issues.*Tid för 1 av 2 repos/);
  await page.locator(".stats").screenshot({ path: testInfo.outputPath("overview-desktop.png") });
  // Prevent normal background synchronization from contributing legitimate root renders.
  await page.evaluate(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const instance = (document.querySelector("#app") as any).__vue_app__._instance;
    const render = instance.render;
    (window as any).overviewAppRenders = 0;
    instance.render = function (...args: unknown[]) { (window as any).overviewAppRenders++; return render.apply(this, args); };
  });
  await page.clock.fastForward(31000);
  await expect(progress.locator(".overview-time")).toHaveText("≈ 1 h 19 min kvar");
  expect(await page.evaluate(() => (window as any).overviewAppRenders)).toBe(0);
  await page.getByRole("link", { name: "Statistik", exact: true }).click();
  await expect(page.locator(".statistics-view")).toBeVisible();
  const paused = await progress.locator(".overview-time").textContent();
  await page.clock.fastForward(minute);
  expect(await progress.locator(".overview-time").textContent()).toBe(paused);
  await page.getByRole("link", { name: "Översikt", exact: true }).click();
  await expect(progress.locator(".overview-time")).toHaveText("≈ 1 h 18 min kvar");
  for (const width of [375, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const key of ["open", "progress"] as const) {
      const badge = tile(page, key).locator(".overview-estimate");
      await expect(badge).toBeVisible();
      expect(await badge.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator(".stats").screenshot({ path: testInfo.outputPath("overview-mobile320.png") });
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(open.locator(".overview-coverage")).toHaveText("Time for 1 of 2 repos");
  await expect(open.locator(".overview-estimate")).toHaveAttribute("aria-label", /Estimated story points: approximately 11.*Points cover the same filtered issues.*Time for 1 of 2 repos/);
});

test("summary points follow global and per-repository queries, combined view and hidden coordination", async ({ page }) => {
  await fixture(page);
  const open = tile(page, "open");
  const search = page.getByRole("textbox", { name: "Filtrera issues i sample/calibrated", exact: true });
  await search.fill("#5");
  await expect(open.locator(".overview-points")).toHaveText("≈ 9 SP");
  await expect(open.locator(".overview-time")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  await expect(open.locator(".overview-points")).toHaveText("≈ 11 SP");
  await expect(open.locator(".overview-time")).toHaveText("≈ 2 h 20 min kvar");
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("#5");
  await expect(open.locator("strong")).toHaveText(/1/);
  await expect(open.locator(".overview-points")).toHaveText("≈ 3 SP");
  await expect(open.locator(".overview-time")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
  await page.getByRole("checkbox", { name: "Dölj koordinationsärenden", exact: true }).uncheck();
  await expect(open.locator(".overview-points")).toHaveText("≈ 24 SP");
});

test("expired history removes summary time while retaining summed points", async ({ page }) => {
  await fixture(page, true);
  const open = tile(page, "open");
  await expect(open.locator(".overview-time")).toHaveText("≈ 2 h 20 min kvar");
  await page.route(url => url.hostname === "api.github.com" && url.pathname.endsWith("/issues"), route => route.abort());
  await page.clock.fastForward(2000);
  await expect(open.locator(".overview-time")).toHaveCount(0);
  await expect(open.locator(".overview-coverage")).toHaveCount(0);
  await expect(open.locator(".overview-points")).toHaveText("≈ 11 SP");
});


test("a future start wakes the estimate without waiting for new data", async ({ page }) => {
  await fixture(page, false, true);
  const progress = tile(page, "progress");
  await expect(progress.locator(".overview-time")).toHaveText("≈ 1 h 30 min kvar");
  await expect(progress.locator(".overview-estimate")).toHaveAttribute("title", /1 pågående saknar säker starttid/);
  await page.clock.fastForward(2 * minute);
  await expect(progress.locator(".overview-time")).toHaveText("≈ 1 h 29 min kvar");
  await expect(progress.locator(".overview-estimate")).not.toHaveAttribute("title", /saknar säker starttid/);
});
