import { expect, test } from "@playwright/test";

// #264: a closed issue never shows a progress label, in Cards and List mode; open issues are unchanged.
const shots = process.env.SHOTS_DIR;
const viewports = [
  { name: "desktop", width: 1600, height: 1000 },
  { name: "narrow", width: 1000, height: 900 },
  { name: "phone-portrait", width: 390, height: 844, phone: true },
  { name: "phone-landscape", width: 844, height: 390, phone: true },
];

for (const vp of viewports) {
  test(`closed issues hide the in-progress label in cards and list (${vp.name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "sv-SE", ...(vp.phone ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const repo = { id: 700, name: "closed-labels", full_name: "sample/closed-labels", description: "Fictional label fixture", private: true, html_url: "https://github.com/sample/closed-labels", owner: { login: "sample" } };
    const now = new Date().toISOString();
    const labels = (...names: string[]) => names.map(name => ({ name, color: "c5def5" }));
    const mk = (id: number, title: string, state: string, names: string[]) => ({ id, number: id, title, state, created_at: now, updated_at: now, closed_at: state === "closed" ? now : null, html_url: `${repo.html_url}/issues/${id}`, labels: labels(...names), assignees: [] });
    const closed = mk(1, "Closed with progress label", "closed", ["in-progress", "documentation-heavy", "frontend-regression", "needs-design-review", "customer-reported"]);
    const open = mk(2, "Open in progress", "open", ["in-progress", "documentation-heavy"]);
    const backlog = mk(3, "Open backlog", "open", ["documentation-heavy"]);
    await page.route("https://api.github.com/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "https://github.com/identicons/sample.png" } });
      if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
      if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "open" ? [open, backlog] : [closed] });
      return route.fulfill({ json: [] });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-closed-label-token");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
    await page.getByRole("checkbox", { name: /sample\/closed-labels/ }).check();
    await page.getByRole("button", { name: "Visa översikt", exact: true }).click();

    const inProgress = '.label[title="in-progress" i]';
    const card = page.locator(".issue-card.closed");
    await expect(card).toHaveCount(1);
    await expect(card.locator(inProgress)).toHaveCount(0);
    await expect(card.locator(".label")).toHaveCount(4);
    await expect(page.locator(".issue-card.backlog .label")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/${vp.name}-cards.png`, fullPage: true });

    await page.getByRole("button", { name: "Lista", exact: true }).first().click();
    const row = page.locator(".issue-row.closed");
    await expect(row).toHaveCount(1);
    await expect(row.locator(inProgress)).toHaveCount(0);
    if (shots) await page.screenshot({ path: `${shots}/${vp.name}-list.png`, fullPage: true });
    await row.getByText("Closed with progress label").click();
    await expect(row.locator(inProgress)).toHaveCount(0);
    if (shots) await page.screenshot({ path: `${shots}/${vp.name}-list-expanded.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
  });
}
