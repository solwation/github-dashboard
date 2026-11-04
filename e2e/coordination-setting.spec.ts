import { expect, test, type Page } from "@playwright/test";
import { openSettings, closePhoneMenu } from "./support/phone-menu";
import { readSettings } from "./support/settings";
import { setBoardGrouping } from "./support/board-grouping";

async function fixture(page: Page) {
  const repos = ["first", "second"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const now = new Date().toISOString();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    const issues = repo ? [false, true].map((coordination, index) => ({ id: repo.id * 10 + index, number: index + 1,
      title: coordination ? `Coordination for ${repo.name}` : `Regular work for ${repo.name}`, body: "Synthetic settings fixture", comments: 0,
      state: "open", labels: coordination ? [{ name: "orkester", color: "abcdef" }] : [], assignees: [],
      created_at: now, updated_at: now, closed_at: null, html_url: `${repo.html_url}/issues/${index + 1}` })) : [];
    await route.fulfill({ json: url.pathname === "/user" ? { login: "coordination-settings-fixture", avatar_url: "" }
      : url.pathname === "/user/repos" ? repos : url.pathname.endsWith("/issues") && url.searchParams.get("state") !== "closed" ? issues : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-coordination-settings-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(2);
}

for (const scenario of [{ width: 1600, height: 1000, touch: false }, { width: 950, height: 900, touch: false }, { width: 390, height: 844, touch: true }]) {
  test(`coordination filter lives in Settings and keeps its saved effect ${scenario.width}`, async ({ browser }, info) => {
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: scenario, locale: "sv-SE", isMobile: scenario.touch, hasTouch: scenario.touch, reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await fixture(page);
      await expect(page.locator(".board-toolbar input[type=checkbox]")).toHaveCount(0);
      await openSettings(page);
      const control = page.getByRole("checkbox", { name: "Dölj koordinationsärenden", exact: true });
      await expect(control).toBeChecked();
      await expect(control).toBeEnabled();
      if (scenario.touch) expect((await control.locator("..").boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // Keyboard activation changes the same account preference as pointer/touch interaction.
      await control.focus(); await control.press("Space");
      await expect(control).not.toBeChecked();
      await page.getByRole("button", { name: "Klart", exact: true }).click();
      await closePhoneMenu(page);
      await expect(page.locator(".issue-card")).toHaveCount(4);
      await expect.poll(() => readSettings(page, "coordination-settings-fixture").then(value => value?.preferences?.hideCoordination)).toBe(false);
      for (const grouping of ["none", "split", "swimlanes"] as const) {
        await setBoardGrouping(page, grouping);
        for (const mode of ["Kort", "Lista"]) {
          await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: mode, exact: true }).click();
          await expect(page.locator(mode === "Kort" ? ".issue-card" : ".issue-row")).toHaveCount(4);
        }
      }
      await page.reload();
      await expect(page.locator(".issue-row")).toHaveCount(4);
      await openSettings(page);
      await expect(control).not.toBeChecked();
      await page.getByLabel("Språk", { exact: true }).selectOption("en");
      const english = page.getByRole("checkbox", { name: "Hide coordination issues", exact: true });
      await expect(english).not.toBeChecked();
      await english.check();
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: info.outputPath(`settings-${scenario.width}-${theme}.png`), fullPage: true });
      }
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await closePhoneMenu(page);
      await expect(page.locator(".issue-row")).toHaveCount(2);
      await expect.poll(() => readSettings(page, "coordination-settings-fixture").then(value => value?.preferences?.hideCoordination)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => /hideCoordination|sample\/first/.test(key + value)))).toBe(false);
    } finally { await context.close(); }
  });
}
