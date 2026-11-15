import { expect, test, type Browser } from "@playwright/test";

// #465: a sub-issue's badge shows the parent's type icon (bug parent -> bug icon); unknown type leaves the badge as before.
const repo = { id: 91, name: "relations", full_name: "sample/relations", private: true, description: "Fictional relations", html_url: "https://github.com/sample/relations", owner: { login: "sample" } };
const stamp = "2026-10-15T12:00:00Z";
const issue = (number: number, title: string) => ({ id: number, number, title, state: "open", created_at: stamp, updated_at: stamp, closed_at: null, labels: [], assignees: [], comments: 0, html_url: `${repo.html_url}/issues/${number}` });
const parents: Record<number, { number: number; title: string; url: string; labels: { nodes: { name: string }[] } }> = {
  1: { number: 10, title: "Crash on startup", url: `${repo.html_url}/issues/10`, labels: { nodes: [{ name: "enhancement" }, { name: "bug" }] } },
  2: { number: 11, title: "Plan without type", url: `${repo.html_url}/issues/11`, labels: { nodes: [{ name: "priority: low" }] } },
  3: { number: 42, title: "Cross repository feature with a long title ".repeat(4), url: "https://github.com/another/planning/issues/42", labels: { nodes: [{ name: "enhancement" }] } },
};
const viewports = [
  { name: "wide desktop", width: 1600, height: 1000, mobile: false },
  { name: "narrow desktop", width: 1000, height: 900, mobile: false },
  { name: "portrait touch", width: 390, height: 844, mobile: true },
  { name: "landscape touch", width: 844, height: 390, mobile: true },
  { name: "narrow touch", width: 320, height: 568, mobile: true },
];

async function connect(browser: Browser, baseURL: string | undefined, device: typeof viewports[number]) {
  const context = await browser.newContext({ baseURL, viewport: { width: device.width, height: device.height }, isMobile: device.mobile, hasTouch: device.mobile, locale: "sv-SE" });
  const page = await context.newPage();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "parent-type-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : [issue(1, "Child of a bug"), issue(2, "Child of an untyped parent"), issue(3, "Child of a cross-repository feature"), issue(4, "Standalone task")] });
    if (url.pathname === "/graphql") {
      const { variables } = route.request().postDataJSON();
      return route.fulfill({ json: { data: { repository: { issue: { parent: parents[variables.number] ?? null, subIssuesSummary: { total: 0, completed: 0 } } } } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-parent-type-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repository-loading")).toHaveCount(0);
  return { context, page };
}

for (const device of viewports) test(`sub-issue badge shows the parent's type icon in Cards and List (${device.name})`, async ({ browser }, info) => {
  const { context, page } = await connect(browser, info.project.use.baseURL, device);
  try {
    for (const view of ["Kort", "Lista"]) {
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: view, exact: true }).click();
      const items = page.locator(view === "Lista" ? ".issue-row" : ".issue-card");
      await expect(items).toHaveCount(4);
      const item = (title: string) => items.filter({ hasText: title });
      const badge = (title: string) => item(title).locator(view === "Lista" ? (device.mobile ? ".row-mobile-relation" : ".row-subtask-badge") : ".subtask-badge");
      // Relations load only for visible items, so bring each one into view first.
      for (let index = 0; index < await items.count(); index++) await items.nth(index).scrollIntoViewIfNeeded();
      await expect(badge("Child of a bug").locator(".parent-type-bug")).toBeVisible();
      await expect(badge("Child of a bug")).toHaveAttribute("title", /#10 · Crash on startup · Typ: Bugg/);
      await expect(badge("Child of a cross-repository feature").locator(".parent-type-feature")).toBeVisible();
      await expect(badge("Child of an untyped parent")).toBeVisible();
      await expect(badge("Child of an untyped parent").locator(".parent-type")).toHaveCount(0);
      await expect(badge("Child of an untyped parent")).not.toHaveAttribute("title", /Typ:/);
      await expect(item("Standalone task").locator(".parent-type")).toHaveCount(0);
      // No page overflow and no badge sticking out of its card/row.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const title of ["Child of a bug", "Child of a cross-repository feature"]) {
        const box = await badge(title).boundingBox(), parentBox = await item(title).boundingBox();
        expect(box && parentBox && box.x >= parentBox.x - 1 && box.x + box.width <= parentBox.x + parentBox.width + 1).toBe(true);
      }
      await page.screenshot({ path: info.outputPath(`parent-type-${view}-${device.name.replace(/ /g, "-")}.png`) });
    }
  } finally { await context.close(); }
});
