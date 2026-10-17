import { expect, test, type Page } from "@playwright/test";

// Each repository header shows its own sync status (#146); the combined board shows the aggregate.
const copy = {
  sv: { connect: "Anslut GitHub", account: "Anslut konto", overview: "Visa översikt", updated: /^Uppdaterad \d{2}[:.]\d{2}$/,
    fetching: (name: string) => `Hämtar issues för ${name}…`, combined: "Hämtar issues för den gemensamma boarden…", split: "Dela upp per repository" },
  en: { connect: "Connect GitHub", account: "Connect account", overview: "Show overview", updated: /^Updated \d{1,2}[:.]\d{2}( ?[AP]M)?$/,
    fetching: (name: string) => `Fetching issues for ${name}…`, combined: "Fetching issues for the combined board…", split: "Split by repository" },
};

async function connect(page: Page, text: (typeof copy)["sv"]) {
  let gate: Promise<void> | undefined;
  let release = () => {};
  const repos = ["alpha", "beta"].map((name, index) => ({
    id: index + 1, name, full_name: `sample/${name}`, private: false, description: "A repository with a fairly long description text",
    html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "status-row-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = repos;
    const repo = repos.find(repo => url.pathname === `/repos/${repo.full_name}/issues`);
    if (repo && url.searchParams.get("state") === "open") {
      // Only alpha's requests wait, so beta finishes while alpha is still being fetched.
      if (repo.name === "alpha") await gate;
      const date = new Date().toISOString();
      data = [{ id: repo.id, number: 1, title: `Status for ${repo.name}`, body: "Fixture", comments: 0, state: "open",
        labels: [], assignees: [], created_at: date, updated_at: date, closed_at: null,
        html_url: `${repo.html_url}/issues/1` }];
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: text.connect, exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-status-token");
  await page.getByRole("button", { name: text.account, exact: true }).click();
  for (const repo of repos) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: text.overview }).click();
  await expect(page.locator(".issue-title")).toHaveCount(2);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  return {
    pause: () => { gate = new Promise(resolve => { release = resolve; }); },
    release: () => { gate = undefined; release(); },
  };
}

const measure = (page: Page) => page.evaluate(() => {
  const header = document.querySelector(".lane-header")!.getBoundingClientRect();
  const status = document.querySelector(".lane-header .lane-sync")!.getBoundingClientRect();
  const title = document.querySelector(".lane-header .lane-title")!.getBoundingClientRect();
  const actions = document.querySelector(".lane-header .lane-actions")!.getBoundingClientRect();
  return {
    board: Math.round(document.querySelector(".repo-lane")!.getBoundingClientRect().top + scrollY),
    headerHeight: Math.round(header.height),
    statusInside: status.right <= header.right + 0.5 && status.top >= header.top - 0.5,
    statusAboveContent: status.bottom <= Math.min(title.top, actions.top) + 0.5,
    actionsWidth: Math.round(actions.width),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    headerOverflow: [...document.querySelectorAll(".lane-header")].some(element => element.scrollWidth > element.clientWidth),
  };
});

for (const [language, text] of Object.entries(copy)) {
  test.describe(language, () => {
    test.use({ locale: language === "sv" ? "sv-SE" : "en-US" });
    test(`each repository header shows its own sync status (${language})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 375, height: 800 });
      const api = await connect(page, text);
      const alpha = page.locator(".repo-lane").filter({ has: page.getByText("Status for alpha") }).locator(".lane-header");
      const beta = page.locator(".repo-lane").filter({ has: page.getByText("Status for beta") }).locator(".lane-header");
      const alphaSpinner = alpha.getByRole("img", { name: text.fetching("sample/alpha") });
      const betaSpinner = beta.getByRole("img", { name: text.fetching("sample/beta") });
      // The global row no longer repeats the time; it is visible beside each repository instead.
      await expect(page.locator(".board-toolbar")).not.toContainText(text.updated);
      await expect(alpha.locator(".lane-sync")).toHaveText(text.updated);
      await expect(beta.locator(".lane-sync")).toHaveText(text.updated);
      for (const width of [320, 375, 430, 768, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        const idle = await measure(page);
        api.pause();
        await page.keyboard.press("Control+r");
        await expect(alphaSpinner).toBeVisible();
        await expect(betaSpinner).toHaveCount(0);
        await expect(beta.locator(".lane-sync")).toHaveText(text.updated);
        const busy = await measure(page);
        if (width === 375) await page.screenshot({ path: testInfo.outputPath(`status-${language}-busy.png`) });
        api.release();
        await expect(alphaSpinner).toHaveCount(0);
        await expect(alpha.locator(".lane-sync")).toHaveText(text.updated);
        await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
        const after = await measure(page);
        for (const [state, sample] of Object.entries({ idle, busy, after })) {
          expect.soft(sample.board, `board at ${width}px (${state})`).toBe(idle.board);
          expect.soft(sample.headerHeight, `header height at ${width}px (${state})`).toBe(idle.headerHeight);
          expect.soft(sample.actionsWidth, `header buttons at ${width}px (${state})`).toBe(idle.actionsWidth);
          expect.soft(sample.statusInside, `status inside header at ${width}px (${state})`).toBe(true);
          expect.soft(sample.statusAboveContent, `status clear of header content at ${width}px (${state})`).toBe(true);
          expect.soft(sample.headerOverflow, `header overflow at ${width}px (${state})`).toBe(false);
          if (width <= 650) expect.soft(sample.overflow, `horizontal scroll at ${width}px (${state})`).toBeLessThanOrEqual(0);
        }
      }
      // The status is not a live region, so background syncs are not announced every cycle.
      expect(await alpha.locator(".lane-sync").evaluate(element => Boolean(element.closest("[aria-live], [role=status]")))).toBe(false);

      // The combined board aggregates all repositories in its header.
      await page.setViewportSize({ width: 375, height: 800 });
      await page.getByRole("checkbox", { name: text.split }).uncheck();
      const head = page.locator(".combined-board-head");
      const combinedSpinner = head.getByRole("img", { name: text.combined });
      await expect(head.locator(".lane-sync")).toHaveText(text.updated);
      api.pause();
      await page.keyboard.press("Control+r");
      await expect(combinedSpinner).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      api.release();
      await expect(combinedSpinner).toHaveCount(0);
      await expect(head.locator(".lane-sync")).toHaveText(text.updated);
    });
  });
}

test("the sync spinner is static with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const api = await connect(page, copy.sv);
  api.pause();
  await page.keyboard.press("Control+r");
  const spinner = page.getByRole("img", { name: copy.sv.fetching("sample/alpha") });
  await expect(spinner).toBeVisible();
  expect(await spinner.locator("svg").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  api.release();
  await expect(spinner).toHaveCount(0);
});
