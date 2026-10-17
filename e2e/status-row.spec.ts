import { expect, test, type Page } from "@playwright/test";

// Each repository header shows its own sync status (#146); the combined board shows the aggregate.
// Only the time or a spinner is shown, as a button that refreshes now (#149).
const copy = {
  sv: { connect: "Anslut GitHub", account: "Anslut konto", overview: "Visa översikt", updated: /^\d{2}[:.]\d{2}$/,
    fetching: (name: string) => `Hämtar issues för ${name}…`, combined: "Hämtar issues för den gemensamma boarden…", split: "Dela upp per repository",
    refreshRepo: (name: string) => new RegExp(`^Senast uppdaterad \\d{2}[:.]\\d{2} · Klicka för att uppdatera ${name} nu$`),
    refreshAll: /^Senast uppdaterad \d{2}[:.]\d{2} · Klicka för att uppdatera alla repositories nu$/,
    tooltip: /^"Senast uppdaterad \d{2}[:.]\d{2} · Klicka för att uppdatera nu"$/, modes: ["Kort", "Lista"] },
  en: { connect: "Connect GitHub", account: "Connect account", overview: "Show overview", updated: /^\d{1,2}[:.]\d{2}(\s?[AP]M)?$/,
    fetching: (name: string) => `Fetching issues for ${name}…`, combined: "Fetching issues for the combined board…", split: "Split by repository",
    refreshRepo: (name: string) => new RegExp(`^Last updated \\d{1,2}[:.]\\d{2}(\\s?[AP]M)? · Click to update ${name} now$`),
    refreshAll: /^Last updated \d{1,2}[:.]\d{2}(\s?[AP]M)? · Click to update all repositories now$/,
    tooltip: /^"Last updated \d{1,2}[:.]\d{2}(\s?[AP]M)? · Click to update now"$/, modes: ["Cards", "List"] },
};

async function connect(page: Page, text: (typeof copy)["sv"]) {
  let gate: Promise<void> | undefined;
  let release = () => {};
  const requests: Record<string, number> = { alpha: 0, beta: 0 };
  const relations: Record<string, number> = { alpha: 0, beta: 0 };
  const repos = ["alpha", "beta"].map((name, index) => ({
    id: index + 1, name, full_name: `sample/${name}`, private: false, description: "A repository with a fairly long description text",
    html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "status-row-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = repos;
    if (url.pathname === "/graphql") {
      const name = (route.request().postDataJSON() as { variables?: { name?: string } }).variables?.name;
      if (name && name in relations) relations[name]!++;
    }
    const repo = repos.find(repo => url.pathname === `/repos/${repo.full_name}/issues`);
    if (repo && url.searchParams.get("state") === "open") {
      requests[repo.name]!++;
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
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  return {
    pause: () => { gate = new Promise(resolve => { release = resolve; }); },
    release: () => { gate = undefined; release(); },
    requests: () => ({ ...requests }),
    relations: () => ({ ...relations }),
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
      const alphaSpinner = alpha.getByRole("button", { name: text.fetching("sample/alpha") });
      const betaSpinner = beta.getByRole("button", { name: text.fetching("sample/beta") });
      // The global row no longer repeats the time; it is visible beside each repository instead.
      await expect(page.locator(".board-toolbar")).not.toContainText(text.updated);
      // #151: no global "Adaptive sync" label; the toolbar keeps only a non-visual data-busy signal.
      await expect(page.locator(".board-toolbar .updated")).toHaveCount(0);
      await expect(page.locator(".board-toolbar")).not.toContainText(language === "sv" ? "Adaptiv synk" : "Adaptive sync");
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
        await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
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
      const combinedSpinner = head.getByRole("button", { name: text.combined });
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
  const spinner = page.getByRole("button", { name: copy.sv.fetching("sample/alpha") });
  await expect(spinner).toBeVisible();
  expect(await spinner.locator(".lane-sync-spinner").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  api.release();
  await expect(spinner).toHaveCount(0);
});

test("the combined board status stays on the summary line in both display modes", async ({ page }) => {
  await connect(page, copy.sv);
  await page.getByRole("checkbox", { name: copy.sv.split }).uncheck();
  const head = page.locator(".combined-board-head");
  await expect(head.locator(".lane-sync")).toHaveText(copy.sv.updated);
  for (const mode of copy.sv.modes) {
    await page.getByRole("button", { name: mode, exact: true }).click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const sample = await head.evaluate(element => {
        const status = element.querySelector<HTMLElement>(".lane-sync")!;
        const summary = element.querySelector("summary")!.getBoundingClientRect();
        const box = status.getBoundingClientRect();
        const height = element.getBoundingClientRect().height;
        status.style.display = "none";
        const without = element.getBoundingClientRect().height;
        status.style.display = "";
        return { height, without, sameLine: box.top < summary.bottom && box.bottom > summary.top, right: box.right <= element.getBoundingClientRect().right };
      });
      expect.soft(sample.height, `combined header height at ${width}px (${mode})`).toBe(sample.without);
      expect.soft(sample.sameLine, `status on the summary line at ${width}px (${mode})`).toBe(true);
      expect.soft(sample.right, `status inside the header at ${width}px (${mode})`).toBe(true);
    }
  }
});

test("the header status refreshes its repository on click and keyboard, ignoring repeats", async ({ page }) => {
  const api = await connect(page, copy.sv);
  // Pause background sync (it only runs for a visible page), so every fetch below comes from the status button.
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  const alpha = page.locator(".repo-lane").filter({ has: page.getByText("Status for alpha") }).locator(".lane-header");
  const beta = page.locator(".repo-lane").filter({ has: page.getByText("Status for beta") }).locator(".lane-header");
  const alphaStatus = alpha.locator("button.lane-sync");
  await expect(alphaStatus).toHaveAccessibleName(copy.sv.refreshRepo("sample/alpha"));
  // The tooltip explains the time and the action on keyboard focus as well as hover.
  await page.keyboard.press("Shift"); // Keyboard modality, so focus is visible.
  await alphaStatus.focus();
  expect(await alphaStatus.evaluate(element => getComputedStyle(element, "::after").content)).toMatch(copy.sv.tooltip);
  expect(await alphaStatus.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe("none");

  let before = api.requests();
  api.pause();
  await alphaStatus.click();
  const alphaSpinner = alpha.getByRole("button", { name: copy.sv.fetching("sample/alpha") });
  await expect(alphaSpinner).toBeVisible();
  await expect(alphaSpinner).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => api.requests().alpha).toBe(before.alpha + 1);
  // Repeated clicks while it runs start nothing, and only the clicked repository is fetched.
  await alphaSpinner.click({ force: true });
  await page.keyboard.press("Enter");
  expect(api.requests()).toEqual({ alpha: before.alpha + 1, beta: before.beta });
  await expect(beta.locator(".lane-sync")).toHaveText(copy.sv.updated);
  const relationsBefore = api.relations();
  api.release();
  await expect(alphaSpinner).toHaveCount(0);
  await expect(alphaStatus).toHaveText(copy.sv.updated);
  // A targeted refresh revalidates relations only for the clicked repository's cards (#149).
  await expect.poll(() => api.relations().alpha).toBeGreaterThan(relationsBefore.alpha);
  await page.waitForTimeout(500);
  expect(api.relations().beta).toBe(relationsBefore.beta);
  await expect(alphaStatus).toBeFocused();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  expect(api.requests()).toEqual({ alpha: before.alpha + 1, beta: before.beta });

  // Keyboard: Enter and Space on the beta status refresh beta.
  for (const key of ["Enter", " "]) {
    await expect(beta.locator("button.lane-sync")).toHaveAccessibleName(copy.sv.refreshRepo("sample/beta"));
    before = api.requests();
    await beta.locator("button.lane-sync").focus();
    await page.keyboard.press(key);
    await expect.poll(() => api.requests().beta).toBe(before.beta + 1);
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    expect(api.requests().alpha).toBe(before.alpha);
  }

  // The combined board refreshes every repository at once, showing the spinner until all are done.
  await page.getByRole("checkbox", { name: copy.sv.split }).uncheck();
  const combined = page.locator(".combined-board-head button.lane-sync");
  await expect(combined).toHaveAccessibleName(copy.sv.refreshAll);
  before = api.requests();
  api.pause();
  await combined.click();
  const combinedSpinner = page.locator(".combined-board-head").getByRole("button", { name: copy.sv.combined });
  await expect(combinedSpinner).toBeVisible();
  await expect.poll(api.requests).toEqual({ alpha: before.alpha + 1, beta: before.beta + 1 });
  await combinedSpinner.click({ force: true });
  expect(api.requests()).toEqual({ alpha: before.alpha + 1, beta: before.beta + 1 });
  api.release();
  await expect(combinedSpinner).toHaveCount(0);
  await expect(combined).toHaveText(copy.sv.updated);
  expect(api.requests()).toEqual({ alpha: before.alpha + 1, beta: before.beta + 1 });
});

test("the demo board shows the time without a refresh button", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".lane-header .lane-sync").first()).toHaveText(copy.sv.updated);
  await expect(page.locator(".lane-header button.lane-sync")).toHaveCount(0);
});
