import { expect, test } from "@playwright/test";

// #375: a device clock 16 minutes behind GitHub left just-started work at "0m 0s" and new issues
// "+16 min" in the future. Board clocks now never run behind received GitHub timestamps.
const shots = process.env.SHOTS_DIR;
const viewports = [
  { name: "desktop", width: 1600, height: 1000 },
  { name: "narrow", width: 1000, height: 900 },
  { name: "phone-portrait", width: 390, height: 844, phone: true },
  { name: "phone-landscape", width: 844, height: 390, phone: true },
];

for (const vp of viewports) {
  test(`timers and ages tick from GitHub time on a slow device clock (${vp.name})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "sv-SE", ...(vp.phone ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    const ahead = new Date(Date.now() + 16 * 60000).toISOString();
    const repo = { id: 375, name: "clock-skew", full_name: "sample/clock-skew", description: "Fictional clock fixture", private: true, html_url: "https://github.com/sample/clock-skew", owner: { login: "sample" } };
    const mk = (id: number, title: string, labels: string[]) => ({ id, number: id, title, state: "open", comments: 0, created_at: ahead, updated_at: ahead, closed_at: null, html_url: `${repo.html_url}/issues/${id}`, labels: labels.map(name => ({ name, color: "c5def5" })), assignees: [] });
    await page.route("https://api.github.com/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "https://github.com/identicons/sample.png" } });
      if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
      if (url.pathname.endsWith("/issues/1/events")) return route.fulfill({ json: [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: ahead }] });
      if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "open" ? [mk(1, "Just claimed work", ["in-progress"]), mk(2, "Just filed work", [])] : [] });
      return route.fulfill({ json: [] });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-clock-skew-token");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
    await page.getByRole("checkbox", { name: /sample\/clock-skew/ }).check();
    await page.getByRole("button", { name: "Visa översikt", exact: true }).click();

    const card = page.locator(".issue-card").filter({ hasText: "Just claimed work" });
    // Offscreen clocks pause by design (#120); phones stack the columns.
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".timer")).toHaveText(/^0m [1-9]\d?s$/, { timeout: 5000 });
    await expect(page.locator(".issue-card").filter({ hasText: "Just filed work" }).locator(".backlog-age")).not.toContainText(/om|\+/);
    if (shots) await page.screenshot({ path: `${shots}/clock-skew-cards-${vp.name}.png` });

    await page.locator(".board-toolbar").getByRole("button", { name: "Lista", exact: true }).click();
    const row = page.locator(".issue-row").filter({ hasText: "Just claimed work" });
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator(".row-elapsed-label")).toHaveText(/^0m [1-9]\d?s$/, { timeout: 5000 });
    const before = await row.locator(".row-elapsed-label").textContent();
    await expect(row.locator(".row-elapsed-label")).not.toHaveText(before!, { timeout: 3000 });
    const age = page.locator(".issue-row").filter({ hasText: "Just filed work" });
    await expect(age).not.toContainText("+");
    if (shots) await page.screenshot({ path: `${shots}/clock-skew-list-${vp.name}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await context.close();
  });
}
