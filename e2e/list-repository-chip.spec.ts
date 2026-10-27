import { expect, test, type Page, type BrowserContext, type TestInfo } from "@playwright/test";

const repos = [
  { id: 901, name: "lunden-3d-apartment-with-a-very-long-repository-name", full_name: "sample/lunden-3d-apartment-with-a-very-long-repository-name", description: "Fictional layout fixture", private: false, html_url: "https://github.com/sample/lunden-3d-apartment-with-a-very-long-repository-name", owner: { login: "sample" } },
  { id: 902, name: "github-dashboard", full_name: "sample/github-dashboard", description: "Fictional layout fixture", private: false, html_url: "https://github.com/sample/github-dashboard", owner: { login: "sample" } },
];
const longTitle = "Bion i lekstugan: vinjett i stället för klicktext på duken, 7.1-högtalare och dimmade lampetter under film";
const created = new Date(Date.now() - 86_400_000).toISOString();
const issues = repos.flatMap((repo, repoIndex) => [
  { id: repoIndex * 3 + 1, number: repoIndex * 100 + 1, title: repoIndex === 0 ? longTitle : `${repo.name}: another backlog item`, state: "open", labels: [{ name: "enhancement", color: "a2eeef" }, { name: "a-very-long-workflow-label-that-must-stay-on-one-line", color: "cfd3d7" }] },
  { id: repoIndex * 3 + 2, number: repoIndex * 100 + 2, title: `${repo.name} pågående`, state: "open", labels: [{ name: "in-progress", color: "fbca04" }] },
  { id: repoIndex * 3 + 3, number: repoIndex * 100 + 3, title: `${repo.name} avslutat`, state: "closed", labels: [{ name: "bug", color: "d73a4a" }] },
].map(issue => ({
  ...issue,
  body: "Fictional public layout fixture; contains no real issue content.",
  comments: 0,
  created_at: created,
  updated_at: created,
  closed_at: issue.state === "closed" ? created : null,
  html_url: `${repo.html_url}/issues/${issue.number}`,
  assignees: [],
})));

async function mockApi(page: Page) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "list-chip-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repos;
    else if (url.pathname === "/graphql") data = { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } };
    else if (url.pathname.endsWith("/events")) data = [];
    else if (url.pathname.endsWith("/issues")) {
      const pathRepo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
      const state = url.searchParams.get("state");
      data = pathRepo ? issues.filter(issue => issue.html_url.startsWith(pathRepo.html_url + "/issues/") && (state === "all" || (state === "closed") === (issue.state === "closed"))) : [];
    }
    await route.fulfill({ json: data });
  });
}

async function connect(page: Page, baseUrl: string) {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-list-chip-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(6);
}

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const modes = [
  { name: "Kort", selector: ".issue-card" },
  { name: "Lista", selector: ".issue-row" },
];
const scenarios = [
  { name: "wide", width: 1600, height: 1000, mobile: false, theme: "light" as const },
  { name: "narrow", width: 1000, height: 900, mobile: false, theme: "dark" as const },
  { name: "portrait", width: 390, height: 844, mobile: true, theme: "light" as const },
  { name: "landscape", width: 844, height: 390, mobile: true, theme: "dark" as const },
  { name: "tiny", width: 320, height: 568, mobile: true, theme: "light" as const },
];

test("combined-list repository chips keep row content aligned at every card/list breakpoint", async ({ page, browser }, testInfo: TestInfo) => {
  test.setTimeout(180_000);
  await mockApi(page);
  await connect(page, "/");
  const origin = new URL(page.url()).origin;
  const bounds = new Map<string, { number: number; title: number; height: number }>();

  async function inspect(contextPage: Page, scenario: typeof scenarios[number], split: boolean, mode: typeof modes[number], info: TestInfo) {
    await contextPage.setViewportSize({ width: 1280, height: 900 });
    const contextSplitToggle = contextPage.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
    const contextViewToggle = contextPage.getByRole("group", { name: "Visningsläge för boarden", exact: true });
    if (await contextSplitToggle.isChecked() !== split) {
      if (split) await contextSplitToggle.check(); else await contextSplitToggle.uncheck();
    }
    const button = contextViewToggle.getByRole("button", { name: mode.name, exact: true });
    if (await button.getAttribute("aria-pressed") !== "true") await button.click();
    await contextPage.setViewportSize({ width: scenario.width, height: scenario.height });
    await contextPage.emulateMedia({ colorScheme: scenario.theme });
    await expect(contextPage.locator("html")).toHaveAttribute("data-theme", scenario.theme === "dark" ? "dark" : "light");

    const board = split ? contextPage.locator(".repo-lane") : contextPage.locator(".combined-board");
    await expect(contextPage.locator(mode.selector)).toHaveCount(6);
    await expect(contextPage.locator(mode.name === "Lista" ? ".issue-card" : ".issue-row")).toHaveCount(0);
    expect(await noPageScroll(contextPage), `${scenario.name} ${split ? "split" : "combined"} ${mode.name} page overflow`).toBe(true);

    if (mode.name === "Kort") {
      await expect(contextPage.locator(".repo-lane")).toHaveCount(split ? 2 : 0);
      await expect(contextPage.locator(".combined-board .card-repository")).toHaveCount(split ? 0 : 6);
      if (!split && ["wide", "portrait"].includes(scenario.name)) {
        await contextPage.screenshot({ path: info.outputPath(`cards-${scenario.name}-${scenario.theme}.png`), fullPage: true });
      }
      return null;
    }

    const rows = contextPage.locator(".issue-row");
    await expect(contextPage.locator(".repo-lane")).toHaveCount(split ? 2 : 0);
    if (split) await expect(rows.locator(".row-repository")).toHaveCount(0);
    else await expect(rows.locator(".row-repository")).toHaveCount(6);

    const row = rows.filter({ hasText: longTitle }).first();
    await expect(row.locator(".row-title")).toHaveAttribute("title", longTitle);
    const rowBox = (await row.boundingBox())!;
    const numberBox = (await row.locator(".row-number").boundingBox())!;
    const titleBox = (await row.locator(".row-title").boundingBox())!;
    const geometry = { number: numberBox.x - rowBox.x, title: titleBox.x - rowBox.x, height: rowBox.height };
    const geometryKey = `${scenario.name}:${split ? "split" : "combined"}`;
    bounds.set(geometryKey, geometry);

    if (!split) {
      const chip = row.locator(".row-repository");
      const repository = repos[0]!;
      await expect(chip).toHaveAttribute("title", repository.full_name);
      await expect(chip.locator(".sr-only")).toHaveText(repository.full_name);
      if (scenario.name === "tiny") await expect(chip.locator(".row-repository-name")).toBeHidden();
      else await expect(chip.locator(".row-repository-name")).toBeVisible();
      const chipBox = (await chip.boundingBox())!;
      expect(chipBox.width, `${scenario.name} chip width`).toBeLessThanOrEqual(scenario.mobile && scenario.width <= 360 ? 68 : 164);
      if (!scenario.mobile) {
        await expect(row.locator(".row-meta > .row-meta-repository")).toHaveCount(1);
        const statusBox = (await row.locator(".row-status").boundingBox())!;
        const priorityBox = (await row.locator(".row-slot-priority").boundingBox())!;
        expect(chipBox.x).toBeLessThan(statusBox.x);
        expect(statusBox.x).toBeLessThanOrEqual(priorityBox.x);
      } else await expect(row.locator(".row-mobile-summary .row-repository")).toHaveCount(1);

      if (scenario.theme === "light") {
        const sidebarColor = await contextPage.locator(`[data-repository="${repository.full_name}"] .repo-dot`).evaluate(node => getComputedStyle(node).backgroundColor);
        const chipColor = await chip.locator("i").evaluate(node => getComputedStyle(node).backgroundColor);
        expect(chipColor).toBe(sidebarColor);
      }
      if (["wide", "narrow", "portrait", "landscape", "tiny"].includes(scenario.name)) {
        await contextPage.screenshot({ path: info.outputPath(`list-combined-${scenario.name}-${scenario.theme}.png`), fullPage: true });
      }
    } else if (["wide", "portrait"].includes(scenario.name)) {
      await contextPage.screenshot({ path: info.outputPath(`list-split-${scenario.name}-${scenario.theme}.png`), fullPage: true });
    }

    return geometry;
  }

  const mobileContext: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, isMobile: true, hasTouch: true, locale: "sv-SE" });
  const mobilePage = await mobileContext.newPage();
  await mockApi(mobilePage);
  await connect(mobilePage, new URL("/", origin).toString());
  expect(await mobilePage.evaluate(() => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(false);

  try {
    for (const scenario of scenarios) {
      const contextPage = scenario.mobile ? mobilePage : page;
      for (const split of [true, false]) {
        for (const mode of modes) await inspect(contextPage, scenario, split, mode, testInfo);
      }
      const splitBounds = bounds.get(`${scenario.name}:split`)!;
      const combinedBounds = bounds.get(`${scenario.name}:combined`)!;
      expect(Math.abs(splitBounds.number - combinedBounds.number), `${scenario.name} number column`).toBeLessThanOrEqual(1);
      expect(Math.abs(splitBounds.title - combinedBounds.title), `${scenario.name} title column`).toBeLessThanOrEqual(1);
      expect(Math.abs(splitBounds.height - combinedBounds.height), `${scenario.name} row height`).toBeLessThanOrEqual(1);
    }
  } finally {
    await mobileContext.close();
  }
});
