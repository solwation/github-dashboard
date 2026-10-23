import { expect, test, type Page } from "@playwright/test";

// Sub-issue time is deducted from the parent's remaining estimate in the In progress badges (#279).
const minute = 60000, day = 86400000, base = Date.parse("2026-10-20T12:00:00Z");
const iso = (at: number) => new Date(at).toISOString();
const repo = { id: 2790, name: "parent-estimates", full_name: "sample/parent-estimates", private: true, html_url: "https://github.com/sample/parent-estimates", owner: { login: "sample" } };

async function fixture(page: Page, parentInProgress: boolean) {
  const item = (number: number, points: number, extra: Record<string, unknown> = {}) => ({
    id: repo.id * 100 + number, number, title: `Fixture work ${number}`, body: "", comments: 0, state: "open",
    labels: [{ name: `points: ${points}`, color: "000000" }], assignees: [], created_at: iso(base - 5 * day), updated_at: iso(base - day),
    closed_at: null, html_url: `${repo.html_url}/issues/${number}`, ...extra,
  });
  const closed = (number: number, end: number) => item(number, 1, { state: "closed", closed_at: iso(end), workStartedAt: iso(end - 30 * minute) });
  const progress = [{ name: "in-progress", color: "000000" }];
  // History: 30 min per point. Closed child: 30 min of real work, two hours ago.
  const closedChild = closed(11, base - 2 * 60 * minute);
  const runningChild = item(12, 1, { title: "Running sub-issue", labels: [{ name: "points: 1", color: "000000" }, ...progress] });
  const parent = item(10, 5, { title: "Parent with sub-issues", sub_issues_summary: { total: 2, completed: 1, percent_completed: 50 },
    labels: [{ name: "points: 5", color: "000000" }, ...(parentInProgress ? progress : [])] });
  const issues = [closed(1, base - day), closed(2, base - 2 * day), closed(3, base - 3 * day), closedChild, runningChild, parent];
  let subIssueRequests = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === `/repos/${repo.full_name}/issues/10/sub_issues`) { subIssueRequests++; return route.fulfill({ json: [closedChild, runningChild] }); }
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    await route.fulfill({ json: url.pathname === "/user" ? { login: "sub-issue-estimate-fixture", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo]
      : event ? [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: iso(base - 10 * minute) }]
      : url.pathname === `/repos/${repo.full_name}/issues` ? issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) : [] });
  });
  await page.clock.install({ time: base - minute });
  await page.clock.pauseAt(base);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-sub-issue-estimates-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  return () => subIssueRequests;
}

for (const [name, parentInProgress, expected] of [
  // 5 points × 30 min − 10 min parent − 10 min running child − 30 min closed child.
  ["parent in progress", true, "≈ 1 h 40 min kvar"],
  // Backlog parent: 150 − 10 min running child − 30 min closed child; the group counts as in progress.
  ["parent in backlog", false, "≈ 1 h 50 min kvar"],
] as const) test(`In progress badges deduct sub-issue time once (${name})`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests = await fixture(page, parentInProgress);
  const column = page.locator(".board-column.progress .column-estimate").first();
  const overview = page.locator('.stats [data-stat="progress"] .overview-time');
  await expect(column).toHaveText(new RegExp(`·\\s*${expected}`));
  await expect(overview).toHaveText(expected);
  await expect(column).toHaveAttribute("title", /dras av från huvudärendets uppskattning; underärenden räknas inte en gång till/);
  await expect(page.locator('.stats [data-stat="progress"] .overview-estimate')).toHaveAttribute("aria-label", /underärenden.*dras av/);
  expect(requests()).toBe(1);
  await page.locator(".stats").screenshot({ path: testInfo.outputPath(`overview-${parentInProgress ? "progress" : "backlog"}-parent.png`) });
  await page.locator(".board-column.progress").first().screenshot({ path: testInfo.outputPath(`column-${parentInProgress ? "progress" : "backlog"}-parent.png`) });
  await page.screenshot({ path: testInfo.outputPath(`board-${parentInProgress ? "progress" : "backlog"}-parent.png`) });
  // Story points follow the same grouping (#281): the whole group's 5 points, not the child's 1.
  await expect(page.locator('.stats [data-stat="progress"] .overview-points')).toHaveText("≈ 5 SP");
  await expect(page.locator('.stats [data-stat="open"] .overview-points')).toHaveText("≈ 5 SP");
  if (!parentInProgress) await expect(page.locator('.stats [data-stat="progress"] .overview-estimate'))
    .toHaveAttribute("aria-label", /räknas en gång, med huvudärendets poäng/);
  await page.clock.fastForward(5 * minute);
  // Two clocks run (parent and child) when the parent is in progress, one otherwise.
  await expect(overview).toHaveText(parentInProgress ? "≈ 1 h 30 min kvar" : "≈ 1 h 45 min kvar");
});

// The parent's own card and list row use the badge's group rule (#281).
for (const [viewport, width, height, touch] of [["desktop", 1600, 1000, false], ["phone", 390, 844, true]] as const) {
  for (const [name, parentInProgress, expected, later] of [
    ["parent in progress", true, "≈ 1 h 40 min kvar", "≈ 1 h 30 min kvar"],
    ["parent in backlog", false, "≈ 1 h 50 min kvar", "≈ 1 h 45 min kvar"],
  ] as const) test(`parent card and row deduct sub-issue time (${viewport}, ${name})`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, locale: "sv-SE" });
    const page = await context.newPage();
    try {
      const requests = await fixture(page, parentInProgress);
      const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
      const shot = (kind: string) => testInfo.outputPath(`${kind}-${viewport}-${parentInProgress ? "progress" : "backlog"}-parent.png`);
      await mode.getByRole("button", { name: "Kort", exact: true }).click();
      const card = page.locator(".issue-card").filter({ hasText: "Parent with sub-issues" });
      const cardTime = card.locator(".issue-time-remaining");
      await expect(cardTime.locator(".issue-time-remaining-label")).toHaveText(expected);
      await expect(cardTime).toHaveAttribute("title", /Tid på underärenden avdragen: ≈ 40 min/);
      await expect(cardTime.getByRole("progressbar")).toHaveCount(1);
      await expect(card.locator(".issue-points")).toHaveAttribute("title", new RegExp(`Uppskattad tid kvar: ${expected.replace(" kvar", "")}`));
      // The running child's own card keeps its own forecast: 30 min − 10 min.
      await expect(page.locator(".issue-card").filter({ hasText: "Running sub-issue" }).locator(".issue-time-remaining-label")).toHaveText("≈ 20 min kvar");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: shot("card") });
      await page.screenshot({ path: shot("cards-page") });
      await mode.getByRole("button", { name: "Lista", exact: true }).click();
      const row = page.locator(".issue-row").filter({ hasText: "Parent with sub-issues" });
      const rowTime = row.locator(parentInProgress ? ".row-outcome .issue-time-remaining-label" : ".row-outcome .issue-time-estimate");
      await expect(rowTime).toHaveText(expected);
      await expect(row.locator(".row-outcome > *").first()).toHaveAttribute("title", /Tid på underärenden avdragen: ≈ 40 min/);
      expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const height = (await row.boundingBox())!.height;
      const other = (await page.locator(".issue-row").filter({ hasText: "Running sub-issue" }).boundingBox())!.height;
      expect(Math.abs(height - other)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await row.scrollIntoViewIfNeeded();
      await row.screenshot({ path: shot("row") });
      await page.screenshot({ path: shot("list-page") });
      await page.clock.fastForward(5 * minute);
      await expect(rowTime).toHaveText(later);
      await mode.getByRole("button", { name: "Kort", exact: true }).click();
      await expect(cardTime.locator(".issue-time-remaining-label")).toHaveText(later);
      expect(requests()).toBe(1);
    } finally {
      await context.close();
    }
  });
}
