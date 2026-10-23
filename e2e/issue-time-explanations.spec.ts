import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

const base = Date.parse("2026-10-15T10:00:00Z"), minute = 60_000, day = 86_400_000;
const repository = { id: 246, name: "very-long-project-repository-name", full_name: "sample/very-long-project-repository-name", private: true,
  html_url: "https://github.com/sample/very-long-project-repository-name", owner: { login: "sample" } };
const iso = (at: number) => new Date(at).toISOString();

function issuesFor(fewClosures = false) {
  const history = fewClosures ? 2 : 4;
  return Array.from({ length: 7 }, (_, index) => {
    const number = index + 1, closed = number <= history, progress = number === 5 || number === 6;
    const closedAt = base - number * day;
    const start = number === 5 ? base - 10 * minute : number === 6 ? base - 40 * minute : closed ? closedAt - 30 * minute : undefined;
    return { id: number, number, title: number === 7 ? "A backlog issue with a long title for narrow phones" : `Timing ${number}`,
      body: "", comments: 0, state: closed ? "closed" : "open", labels: ["story-points: 1", ...(progress ? ["in-progress"] : [])].map(name => ({ name, color: "000000" })), assignees: [],
      created_at: iso(base - 5 * day), updated_at: iso(base - day), startedAt: closed || progress ? iso(start) : undefined,
      closed_at: closed ? iso(closedAt) : null, html_url: `${repository.html_url}/issues/${number}` };
  });
}

async function prepare(page: Page, fewClosures = false) {
  const issues = issuesFor(fewClosures);
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    const number = Number(event?.[1]);
    const issue = issues.find(item => item.number === number);
    const body = url.pathname === "/user" ? { login: "time-explanation-fixture", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repository]
      : event ? (issue?.startedAt ? [{ id: number, event: "labeled", label: { name: "in-progress" }, created_at: issue.startedAt }] : [])
      : url.pathname.endsWith("/issues") ? issues.filter(item => url.searchParams.get("state") === "all" || item.state === url.searchParams.get("state")) : [];
    await route.fulfill({ json: body });
  });
  await page.clock.install({ time: base - minute });
  await page.clock.pauseAt(base);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-time-explanation-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repository.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
}

async function openDetails(page: Page, number: number, keyboard = false) {
  const row = page.locator(".issue-row").filter({ has: page.getByRole("button", { name: `Timing ${number}`, exact: true }) });
  const title = row.getByRole("button", { name: `Timing ${number}`, exact: true });
  if (keyboard) { await title.focus(); await page.keyboard.press("Enter"); }
  else await title.click();
  const detailsToggle = page.locator(".row-popup .details-toggle");
  if (await detailsToggle.count() && await detailsToggle.getAttribute("aria-expanded") === "false") await detailsToggle.tap();
  const explanation = page.locator(".time-explanation");
  await expect(explanation).toBeVisible();
  return explanation;
}

const viewportMatrix = [["desktop-wide", 1600, 1000, false], ["desktop-narrow", 1000, 900, false],
  ["phone-portrait", 390, 844, true], ["phone-landscape", 844, 390, true], ["phone-narrow", 320, 568, true]] as const;

for (const [name, width, height, touch] of viewportMatrix) {
  test(`time explanation in ${name} Cards/List and split/combined views`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, locale: "sv-SE" });
    const page = await context.newPage();
    try {
      await prepare(page);
      const mode = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
      await mode.getByRole("button", { name: "Kort", exact: true }).click();
      await expect(page.locator(".issue-card")).toHaveCount(7);
      await expect(page.locator(".issue-card .details-toggle")).toHaveCount(7);
      const firstCard = page.locator(".issue-card").first();
      await firstCard.getByRole("button", { name: "Läs mer", exact: true }).click();
      await expect(firstCard.locator(".time-explanation")).toBeVisible();
      await expect(firstCard.locator(".time-explanation")).toContainText("grov storleksindikator");
      await firstCard.getByRole("button", { name: "Visa mindre", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".swimlane").first().screenshot({ path: testInfo.outputPath(`${name}-cards-split.png`) });
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".swimlane").first().screenshot({ path: testInfo.outputPath(`${name}-cards-combined.png`) });
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).check();
      await mode.getByRole("button", { name: "Lista", exact: true }).click();
      await expect(page.locator(".issue-row")).toHaveCount(7);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".swimlane").first().screenshot({ path: testInfo.outputPath(`${name}-list-split.png`) });
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".swimlane").first().screenshot({ path: testInfo.outputPath(`${name}-list-combined.png`) });
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).check();

      const backlog = page.locator(".issue-row").filter({ has: page.getByRole("button", { name: "A backlog issue with a long title for narrow phones", exact: true }) });
      await backlog.getByRole("button", { name: "A backlog issue with a long title for narrow phones", exact: true }).click();
      const detailsToggle = page.locator(".row-popup .details-toggle");
      if (await detailsToggle.count() && await detailsToggle.getAttribute("aria-expanded") === "false") await detailsToggle.tap();
      const explanation = page.locator(".time-explanation");
      await expect(explanation.locator("summary")).toHaveText("Förklara tid och story points");
      const summaryBox = await explanation.locator("summary").boundingBox();
      expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
      expect(summaryBox!.width).toBeGreaterThanOrEqual(44);
      await explanation.locator("summary").click();
      await expect(explanation).toHaveAttribute("open", "");
      await expect(explanation).toContainText("grov storleksindikator");
      await expect(explanation).toContainText("Tidsestimatet är ungefärligt");
      if (name === "phone-narrow" || name === "desktop-wide")
        await page.locator(".row-popup .time-explanation, .row-card .time-explanation").screenshot({ path: testInfo.outputPath(`${name}-backlog-explanation.png`) });
      await page.getByRole("button", { name: "Stäng", exact: true }).first().click();

      if (width === 1000) {
        const keyboard = await openDetails(page, 5, true), summary = keyboard.locator("summary");
        await summary.focus();
        await page.keyboard.press("Enter");
        await expect(keyboard).toHaveAttribute("open", "");
        await expect(summary).toBeFocused();
        await expect(keyboard).toContainText("Förfluten tid räknas från den registrerade starten");
        await expect(keyboard).toContainText("≈ 30 min");
        await expect(keyboard).toContainText("≈ 20 min");
      }
      if (width === 390) {
        const under = await openDetails(page, 5);
        await under.locator("summary").tap();
        await expect(under).toContainText("≈ 20 min");
        await page.locator(".row-popup .time-explanation").screenshot({ path: testInfo.outputPath("phone-under-estimate-explanation.png") });
        await page.getByRole("button", { name: "Stäng", exact: true }).first().tap();
        const over = await openDetails(page, 6);
        await over.locator("summary").tap();
        await expect(over).toContainText("över uppskattning");
        await page.locator(".row-popup .time-explanation").screenshot({ path: testInfo.outputPath("phone-over-estimate-explanation.png") });
        await page.getByRole("button", { name: "Stäng", exact: true }).first().tap();
        const closed = await openDetails(page, 4);
        await closed.locator("summary").tap();
        await expect(closed).toContainText("Faktisk arbetstid");
        await expect(closed).toContainText("Jämförelse med historik");
        await expect(closed).toContainText("Om en pil visas betyder ↑ längre och ↓ kortare faktisk arbetstid");
        await expect(closed).toContainText("inte ett sparat ursprungligt löfte");
        await page.locator(".row-popup .time-explanation").screenshot({ path: testInfo.outputPath("phone-closed-explanation.png") });
      }
    } finally { await context.close(); }
  });
}

test("closed issues keep actual time while omitting unavailable comparison details", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "sv-SE" });
  const page = await context.newPage();
  try {
    await prepare(page, true);
    const row = page.locator(".issue-row").filter({ has: page.getByRole("button", { name: "Timing 2", exact: true }) });
    await row.getByRole("button", { name: "Timing 2", exact: true }).tap();
    const explanation = page.locator(".time-explanation");
    await explanation.locator("summary").tap();
    await expect(explanation).toContainText("Faktisk arbetstid");
    await expect(explanation).not.toContainText("Jämförelse med historik");
    await expect(explanation).not.toContainText("inte ett sparat ursprungligt löfte");
  } finally { await context.close(); }
});

test("time explanation is clear in English as well as Swedish", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await prepare(page);
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("group", { name: "Board view mode", exact: true }).getByRole("button", { name: "List", exact: true }).click();
  const explanation = await openDetails(page, 5, true);
  await explanation.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(explanation).toContainText("Story points are a rough size indicator");
  await expect(explanation).toContainText("The time estimate is approximate");
  await expect(explanation).toContainText("Elapsed work time");
  await expect(explanation).toContainText("Remaining / over");
});
