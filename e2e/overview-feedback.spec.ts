import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page) {
  let stage = 0;
  let requests = 0;
  const repo = { id: 1, name: "alpha", full_name: "sample/alpha", private: false, html_url: "https://github.com/sample/alpha", owner: { login: "sample" } };
  const issue = (id: number, state: string, progress = false, today = false) => ({
    id, number: id, title: "Fixture " + id, state, body: "", comments: 0,
    labels: progress ? [{ name: "in-progress", color: "123456" }] : [], assignees: [],
    created_at: new Date(Date.now() - 86400000).toISOString(), updated_at: new Date().toISOString(),
    closed_at: state === "closed" ? new Date(Date.now() - (today ? 0 : 86400000)).toISOString() : null,
    html_url: "https://github.com/sample/alpha/issues/" + id,
  });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    if (url.pathname === "/user") body = { login: "summary-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") body = [repo];
    else if (url.pathname.endsWith("/issues")) {
      const all = stage === 0 ? [issue(1, "open", true), issue(2, "open", true), issue(3, "closed")]
        : stage === 1 ? [issue(1, "open", true), issue(2, "closed", false, true), issue(3, "closed")]
        : [issue(1, "open"), issue(2, "closed", false, true), issue(3, "closed")];
      if (url.searchParams.get("state") === "open") requests++;
      body = all.filter(issue => issue.state === url.searchParams.get("state"));
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => localStorage.setItem("issueflow:summary-fixture", JSON.stringify({ selected: ["sample/alpha"] })));
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-summary-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  return {
    setStage: (value: number) => { stage = value; },
    refresh: async () => {
      const before = requests;
      await page.keyboard.press("F5");
      await expect.poll(() => requests).toBeGreaterThan(before);
      await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
    },
  };
}
const card = (page: Page, key: string) => page.locator('.stats [data-stat="' + key + '"]');

test("summary colors progress completion green and return to backlog red while keeping search silent", async ({ page }) => {
  const api = await fixture(page);
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  await expect(card(page, "closed").locator(".stat-today")).toContainText("+0 idag");
  api.setStage(1);
  await api.refresh();
  await expect(card(page, "open").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "open")).toHaveClass(/stat-negative/);
  await expect(card(page, "closed").locator(".stat-delta")).toHaveText("+1");
  await expect(card(page, "closed")).toHaveClass(/stat-positive/);
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-positive/);
  await expect(card(page, "closed").locator(".stat-today")).toContainText("+1 idag");
  await api.refresh();
  await expect(card(page, "closed").locator(".stat-delta")).toHaveText("+1");
  // Start a distinct pulse for a return to backlog: the sign stays negative but the color changes.
  await expect(page.locator(".stat-delta")).toHaveCount(0, { timeout: 5000 });
  api.setStage(2);
  await api.refresh();
  await expect(card(page, "open").locator(".stat-delta")).toHaveCount(0);
  await expect(card(page, "closed").locator(".stat-delta")).toHaveCount(0);
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-negative/);
  await expect(page.locator(".stat-delta")).toHaveCount(0, { timeout: 5000 });
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("no matching issues");
  await expect(card(page, "open").locator("strong")).toHaveText(/0/);
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  await api.refresh();
  await expect(page.locator(".stat-delta")).toHaveCount(0);
});

test("mixed completion and backlog batch keeps negative outcome during rapid aggregated updates", async ({ page }) => {
  const api = await fixture(page);
  api.setStage(2);
  await api.refresh();
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−2");
  await expect(card(page, "progress")).toHaveClass(/stat-negative/);
  api.setStage(1);
  await api.refresh();
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-negative/);
  await api.refresh();
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-negative/);
});

test("summary uses accessible English feedback and static reduced-motion colors on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const api = await fixture(page);
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  api.setStage(1);
  await api.refresh();
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByRole("status")).toContainText("Closed: +1");
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-positive/);
  await expect(card(page, "closed").locator(".stat-today")).toContainText("+1 today");
  expect(await card(page, "closed").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".stat-delta")).toHaveCount(0);
});
