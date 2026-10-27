import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

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
        : stage === 2 ? [issue(1, "open"), issue(2, "closed", false, true), issue(3, "closed")]
        : [issue(1, "open", true), issue(2, "closed", false, true), issue(3, "open", true)];
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
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  return {
    setStage: (value: number) => { stage = value; },
    refresh: async () => {
      const before = requests;
      await page.keyboard.press("F5");
      await expect.poll(() => requests).toBeGreaterThan(before);
      await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    },
  };
}
const card = (page: Page, key: string) => page.locator('.stats [data-stat="' + key + '"]');

test("summary colors progress completion green and return to backlog red while keeping search silent", async ({ page }) => {
  const api = await fixture(page);
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  await expect(page.locator(".stats .stat-cells")).toHaveCount(4);
  await expect(card(page, "repositories").locator(".stat-cell")).toHaveText(["1 aktiva", "0 backlog"]);
  await expect(card(page, "open").locator(".stat-cell")).toHaveText(["0 backlog", "0 hög prio"]);
  await expect(card(page, "progress").locator(".stat-cell")).toHaveText(["1 repos", "0 hög prio"]);
  await expect(card(page, "closed").locator(".stat-cell")).toHaveText(["+0 idag", "1 senaste 7 d"]);
  api.setStage(1);
  await api.refresh();
  await expect(card(page, "open").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "open")).toHaveClass(/stat-negative/);
  await expect(card(page, "closed").locator(".stat-delta")).toHaveText("+1");
  await expect(card(page, "closed")).toHaveClass(/stat-positive/);
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-positive/);
  await expect(card(page, "closed").locator(".stat-cell")).toHaveText(["+1 idag", "2 senaste 7 d"]);
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
  await expect(card(page, "repositories").locator(".stat-cell")).toHaveText(["1 aktiva", "1 backlog"]);
  await expect(card(page, "open").locator(".stat-cell")).toHaveText(["1 backlog", "0 hög prio"]);
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
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  api.setStage(1);
  await api.refresh();
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary.getByRole("status")).toContainText("Closed: +1");
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-positive/);
  await expect(card(page, "closed").locator(".stat-cell")).toHaveText(["+1 today", "2 last 7d"]);
  await expect(card(page, "open").locator(".stat-cell")).toHaveText(["0 backlog", "0 high priority"]);
  expect(await card(page, "closed").evaluate(element => getComputedStyle(element).transitionDuration)).toBe("0s");
  expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.reload();
  await expect(page.locator(".repo-lane")).toHaveCount(1);
  await expect(page.locator(".stat-delta")).toHaveCount(0);
});

test("filtered badges animate real changes even when hidden changes cancel the global totals", async ({ page }) => {
  const api = await fixture(page);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("Fixture 2");
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  api.setStage(3);
  await api.refresh();
  await expect(card(page, "open").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("−1");
  await expect(card(page, "progress")).toHaveClass(/stat-positive/);
  await expect(card(page, "closed").locator(".stat-delta")).toHaveText("+1");
  await expect(page.locator(".stat-delta")).toHaveCount(0, { timeout: 5000 });
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  await page.getByRole("button", { name: "Filtrera issues i sample/alpha", exact: true }).click();
  await page.getByRole("textbox", { name: "Filtrera issues i sample/alpha", exact: true }).fill("Fixture 2");
  await expect(page.locator(".stat-delta")).toHaveCount(0);
  api.setStage(0);
  await api.refresh();
  await expect(card(page, "progress").locator(".stat-delta")).toHaveText("+1");
  await expect(card(page, "closed").locator(".stat-delta")).toHaveText("−1");
});
