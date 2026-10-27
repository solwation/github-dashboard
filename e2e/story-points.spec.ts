import { expect, test, type Locator, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

const repo = { id: 210, name: "points-fixture", full_name: "sample/points-fixture", private: true, description: "", html_url: "https://github.com/sample/points-fixture", owner: { login: "sample" } };
const specs = [
  { title: "Explicitly sized work with a long title that should truncate across narrow layouts", labels: ["sp-4", "a-long-workflow-label-with-extra-scope-context"], points: 4, state: "open", exact: true },
  { title: "One point from a label", labels: ["sp-1"], points: 1, state: "open", exact: true },
  { title: "Two points from a label", labels: ["sp-2"], points: 2, state: "open", exact: true },
  { title: "Case insensitive explicit label", labels: ["SP: 5"], points: 5, state: "open", exact: true },
  { title: "Conflicting sizes use local sizing", labels: ["sp-4", "sp-5"], points: 1, state: "open", exact: false },
  { title: "Largest safe explicit size", labels: [`sp-${Number.MAX_SAFE_INTEGER}`], points: Number.MAX_SAFE_INTEGER, state: "open", exact: true },
  { title: "Improve database security", labels: ["in-progress"], points: 3, state: "open", exact: false },
  { title: "Small wording adjustment", labels: [], points: 1, state: "closed", exact: false },
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
// ResizeObserver loop notifications are native window errors, not necessarily pageerror (#343).
async function trackLabelObservers(page: Page) {
  await page.addInitScript(() => {
    const state = { errors: [] as string[], deliveries: 0 };
    Object.assign(window, { labelObserverCheck: state });
    window.addEventListener("error", event => { if (event.message) state.errors.push(event.message); });
    const NativeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          if (entries.some(entry => entry.target.matches(".card-labels, .row-labels"))) state.deliveries++;
          callback(entries, observer);
        });
      }
    };
  });
}
async function assertLabelObserversSettled(page: Page) {
  const result = await page.evaluate(async () => {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    // Allow deferred measurement, Vue rendering and the resulting height-only delivery to finish.
    for (let i = 0; i < 4; i++) await frame();
    const state = (window as Window & { labelObserverCheck: { errors: string[]; deliveries: number } }).labelObserverCheck;
    const before = state.deliveries;
    for (let i = 0; i < 4; i++) await frame();
    return { errors: [...state.errors], settledDeliveries: state.deliveries - before };
  });
  expect(result.errors).toEqual([]);
  expect(result.settledDeliveries).toBe(0);
}
async function assertSizes(items: Locator) {
  await expect(items).toHaveCount(specs.length);
  for (const spec of specs) {
    const badge = items.filter({ hasText: spec.title }).locator(".issue-points");
    await expect(badge).toHaveText(`${spec.exact ? "" : "≈ "}${spec.points} SP`);
    await expect(badge).toHaveAttribute("aria-label", new RegExp(`^${spec.exact ? "Story points från label:" : "Uppskattade story points: cirka"} ${spec.points}[.]`));
    await expect(badge).toHaveAttribute("title", spec.exact ? /Story points från label:/ : /En entydig poängetikett används först.*Inte uppmätt komplexitet/);
  }
}
async function fits(page: Page, badges: Locator) {
  for (const badge of await badges.all()) {
    await expect(badge).toBeVisible();
    const geometry = await badge.evaluate(element => {
      const box = element.getBoundingClientRect(), parent = element.closest(".row-meta, .row-mobile-summary, .issue-card, .issue-row")!.getBoundingClientRect();
      return { text: element.textContent, left: box.left, right: box.right, parentLeft: parent.left, parentRight: parent.right,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
    });
    expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.parentLeft - 1);
    expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.parentRight + 1);
    expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clientWidth + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
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
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const badge = page.locator(".issue-row").filter({ hasText: specs[0]!.title }).locator(".issue-points");
  await expect(badge).toHaveAttribute("aria-label", /^Story points from label: 4\./);
  await expect(badge).toHaveAttribute("title", /Story points from label: 4/);
});

for (const scenario of [
  { name: "wide", width: 1600, height: 1000, mobile: false },
  { name: "narrow", width: 1000, height: 900, mobile: false },
  { name: "portrait", width: 390, height: 844, mobile: true },
  { name: "landscape", width: 844, height: 390, mobile: true },
  { name: "small-phone", width: 320, height: 568, mobile: true },
]) test(`label provenance fits cards and list: ${scenario.name}`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: scenario.mobile, hasTouch: scenario.mobile, locale: "sv-SE", reducedMotion: "reduce" });
  const page = await context.newPage();
  await trackLabelObservers(page);
  await fixture(page);
  // Cross label-fit thresholds before the mode changes unmount the measured cards.
  if (scenario.name === "wide" || scenario.name === "portrait") {
    for (const width of [scenario.width - 100, scenario.mobile ? 320 : 1000, scenario.width]) {
      await page.setViewportSize({ width, height: scenario.height });
      await assertLabelObserversSettled(page);
    }
  }
  const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const split of [true, false]) {
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).setChecked(split);
      for (const view of ["Kort", "Lista"]) {
        await mode.getByRole("button", { name: view, exact: true }).click();
        const items = page.locator(view === "Kort" ? ".issue-card" : ".issue-row");
        await assertSizes(items);
        await fits(page, items.locator(".issue-points"));
        await assertLabelObserversSettled(page);
        if (view === "Lista") {
          const edges = await items.evaluateAll(rows => rows.map(row => ({ left: row.getBoundingClientRect().left, right: row.getBoundingClientRect().right, height: row.getBoundingClientRect().height })));
          for (const row of edges) { expect(Math.abs(row.left - edges[0]!.left)).toBeLessThanOrEqual(1); expect(Math.abs(row.right - edges[0]!.right)).toBeLessThanOrEqual(1); expect(row.height).toBeLessThan(150); }
        }
        await page.screenshot({ path: testInfo.outputPath(`${scenario.name}-${theme}-${split ? "split" : "combined"}-${view === "Kort" ? "cards" : "list"}.png`), fullPage: true });
      }
    }
  }
  if (scenario.mobile) {
    await page.locator(".row-title").filter({ hasText: specs[0]!.title }).click();
    await expect(page.getByRole("dialog").locator(".issue-points")).toHaveText("4 SP");
    await fits(page, page.getByRole("dialog").locator(".issue-points"));
  }
  // Mode and repository collapse remove observed nodes, including pending frame updates.
  if (scenario.mobile) await page.keyboard.press("Escape");
  for (const view of ["Kort", "Lista", "Kort"]) await mode.getByRole("button", { name: view, exact: true }).click();
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).check();
  await page.locator(".repo-lane .collapse-project").click();
  await assertLabelObserversSettled(page);
  await context.close();
});
