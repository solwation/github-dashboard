import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { closePhoneMenu, openSettings } from "./support/phone-menu";

// Fictional fixture: 15 open backlog issues across two repositories (#380).
async function fixture(page: Page, theme: string) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/user") body = { login: "collapse-alpha", avatar_url: "" };
    else if (url.pathname === "/user/repos") body = ["alpha", "bravo"].map((name, id) => ({
      id: id + 1, name, full_name: `sample/${name}`, private: false, description: "Fictional collapse fixture",
      html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
    }));
    else if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      const repo = url.pathname.split("/")[3], base = repo === "alpha" ? 0 : 100, date = new Date().toISOString();
      body = Array.from({ length: repo === "alpha" ? 8 : 7 }, (_, index) => ({
        id: base + index + 1, number: index + 1, title: `Fixture task ${index + 1} with a reasonably long title for wrapping`,
        state: "open", created_at: date, updated_at: date, closed_at: null,
        html_url: `https://github.com/sample/${repo}/issues/${index + 1}`, labels: [], assignees: [],
      }));
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(value => {
    localStorage.setItem("issueflow-theme", value);
    if (!localStorage.getItem("issueflow:collapse-alpha")) localStorage.setItem("issueflow:collapse-alpha", JSON.stringify({ selected: ["sample/alpha", "sample/bravo"] }));
  }, theme);
}

const scenarios = [
  { name: "desktop-1600x1000", viewport: { width: 1600, height: 1000 }, touch: false, theme: "light" },
  { name: "desktop-1000x900", viewport: { width: 1000, height: 900 }, touch: false, theme: "dark" },
  { name: "phone-390x844", viewport: { width: 390, height: 844 }, touch: true, theme: "dark" },
  { name: "phone-844x390", viewport: { width: 844, height: 390 }, touch: true, theme: "light" },
];

// One theme per viewport keeps the suite short while still covering both themes.
for (const scenario of scenarios) for (const mode of ["Kort", "Lista"]) {
  const theme = scenario.theme;
  test.describe(`${scenario.name} ${mode} ${theme}`, () => {
    test.use({ viewport: scenario.viewport, hasTouch: scenario.touch, isMobile: scenario.touch });
    test("combined column collapses back to the configured count by click and keyboard", async ({ page }) => {
      await fixture(page, theme);
      await page.goto("/");
      await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
      await page.getByLabel("GitHub personal access token").fill("fictional-collapse-token");
      await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
      await expect(page.locator(".repo-lane")).toHaveCount(2);
      await openSettings(page);
      await page.locator("#global-column-limit").fill("3");
      await page.getByRole("button", { name: "Klart", exact: true }).click();
      await closePhoneMenu(page);
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: mode, exact: true }).click();
      // The split board never shows the button, expanded or not.
      await page.locator("#repo-1 .backlog").getByRole("button", { name: "Visa fler" }).click();
      await expect(page.locator(".column-collapse-button")).toHaveCount(0);
      await page.evaluate(() => scrollTo(0, 0));
      await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
      const backlog = page.locator(".combined-board .board-column.backlog");
      const entries = backlog.locator(mode === "Lista" ? ".issue-row" : ".issue-card");
      const collapse = backlog.getByRole("button", { name: /^Fäll ihop Backlog till 3 issues$/ });
      await expect(entries).toHaveCount(3);
      await expect(collapse).toHaveCount(0);
      await backlog.getByRole("button", { name: "Visa fler" }).click();
      await expect(entries).toHaveCount(6);
      await expect(collapse).toBeVisible();
      await expect(collapse).toHaveAttribute("title", "Fäll ihop till 3 issues");
      const evidence = process.env.EVIDENCE_DIR;
      const shot = async (suffix: string) => { if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: `${evidence}/${scenario.name}-${mode}-${theme}-${suffix}.png` }); } };
      await collapse.evaluate(el => el.closest(".column-header")!.scrollIntoView({ block: "center" }));
      await shot("expanded");
      const box = (await collapse.boundingBox())!, sort = (await backlog.locator(".column-sort-button").boundingBox())!;
      if (scenario.touch) { expect(box.width).toBeGreaterThanOrEqual(43.9); expect(box.height).toBeGreaterThanOrEqual(43.9); }
      else expect(Math.abs((box.y + box.height / 2) - (sort.y + sort.height / 2))).toBeLessThanOrEqual(1);
      const headerBox = (await backlog.locator(".column-header").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(headerBox.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (scenario.touch) await collapse.tap(); else await collapse.click();
      await expect(entries).toHaveCount(3);
      await expect(collapse).toHaveCount(0);
      // Keyboard: expand again, then activate the header button with Enter and Space.
      for (const key of ["Enter", "Space"]) {
        await backlog.getByRole("button", { name: "Visa fler" }).click();
        await expect(entries).toHaveCount(6);
        await collapse.focus();
        await page.keyboard.press(key);
        await expect(entries).toHaveCount(3);
        await expect(collapse).toHaveCount(0);
      }
      await backlog.getByRole("button", { name: "Visa fler" }).click();
      await backlog.getByRole("button", { name: "Visa fler" }).click();
      await expect(entries).toHaveCount(9);
      await collapse.click();
      await expect(entries).toHaveCount(3);
      await shot("collapsed");
    });
  });
}

test("collapse label is translated in English", async ({ page }) => {
  await fixture(page, "light");
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-collapse-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("spinbutton", { name: "Maximum work items shown per column" }).fill("3");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await closePhoneMenu(page);
  await page.getByRole("checkbox", { name: "Split by repository", exact: true }).uncheck();
  const backlog = page.locator(".combined-board .board-column.backlog");
  await backlog.getByRole("button", { name: "Show more" }).click();
  const button = backlog.getByRole("button", { name: "Collapse Backlog to 3 issues" });
  await expect(button).toContainText("Collapse");
  await button.click();
  await expect(button).toHaveCount(0);
});
