import { expect, test } from "@playwright/test";

// #392: an open integration-ready issue waits in In progress with a visible, accessible indicator
// instead of a running timer, in Cards and List, in both languages and themes.
const shots = process.env.SHOTS_DIR;
const viewports = [
  { name: "desktop", width: 1600, height: 1000 },
  { name: "narrow", width: 1000, height: 900 },
  { name: "phone-portrait", width: 390, height: 844, phone: true },
  { name: "phone-landscape", width: 844, height: 390, phone: true },
  { name: "phone-320", width: 320, height: 568, phone: true },
];
const variants = [
  { language: "sv", theme: "light", waiting: "Väntar på integration", active: "Aktiv arbetstid", list: "Lista", cards: "Kort" },
  { language: "en", theme: "dark", waiting: "Awaiting integration", active: "Active working time", list: "List", cards: "Cards" },
] as const;

for (const vp of viewports) for (const variant of variants) {
  if (variant.language === "en" && !["desktop", "phone-portrait"].includes(vp.name)) continue;
  test(`integration-ready waits in In progress with an indicator (${vp.name}, ${variant.language}, ${variant.theme})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: variant.language === "sv" ? "sv-SE" : "en-US",
      ...("phone" in vp ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await page.addInitScript(([language, theme]) => {
      localStorage.setItem("issueflow-language", language);
      localStorage.setItem("issueflow-theme", theme);
    }, [variant.language, variant.theme]);
    const repo = { id: 392, name: "handoffs", full_name: "sample/handoffs", description: "Fictional handoff fixture", private: true, html_url: "https://github.com/sample/handoffs", owner: { login: "sample" } };
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
    const labels = (...names: string[]) => names.map(name => ({ name, color: "c5def5" }));
    const mk = (id: number, title: string, state: string, names: string[], extra = {}) => ({ id, number: id, title, state, comments: 0, created_at: ago(600), updated_at: ago(30),
      closed_at: state === "closed" ? ago(60) : null, html_url: `${repo.html_url}/issues/${id}`, labels: labels(...names), assignees: [], ...extra });
    const waiting = mk(1, "Finished handoff with a fairly long title that waits for integration", "open", ["integration-ready", "orkester: fixture-session", "priority: high"]);
    const active = mk(2, "Active integration", "open", ["in-progress", "orkester: fixture-session"]);
    const closed = mk(3, "Integrated earlier", "closed", ["integration-ready", "documentation"]);
    // Calibration history: 20 minutes per closing, so the waiting issue would be far over its estimate if it counted.
    const history = [101, 102, 103].map(id => mk(id, "History work", "closed", [], { workStartedAt: ago(80) }));
    const events: Record<number, unknown[]> = {
      1: [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: ago(200) },
        { id: 2, event: "unlabeled", label: { name: "in-progress" }, created_at: ago(150) },
        { id: 3, event: "labeled", label: { name: "integration-ready" }, created_at: ago(150) }],
      2: [{ id: 4, event: "labeled", label: { name: "in-progress" }, created_at: ago(300) },
        { id: 5, event: "unlabeled", label: { name: "in-progress" }, created_at: ago(290) },
        { id: 6, event: "labeled", label: { name: "integration-ready" }, created_at: ago(290) },
        { id: 7, event: "unlabeled", label: { name: "integration-ready" }, created_at: ago(5) },
        { id: 8, event: "labeled", label: { name: "in-progress" }, created_at: ago(5) }],
    };
    await page.route("https://api.github.com/**", async route => {
      const url = new URL(route.request().url());
      const match = url.pathname.match(/\/issues\/(\d+)\/events$/);
      if (url.pathname === "/user") return route.fulfill({ json: { login: "sample", avatar_url: "https://github.com/identicons/sample.png" } });
      if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
      if (match) return route.fulfill({ json: events[Number(match[1])] ?? [] });
      if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "open" ? [waiting, active] : [closed, ...history] });
      return route.fulfill({ json: [] });
    });
    await page.goto("/");
    const sv = variant.language === "sv";
    await page.getByRole("button", { name: sv ? "Anslut GitHub" : "Connect GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-handoff-token");
    await page.getByRole("button", { name: sv ? "Anslut konto" : "Connect account", exact: true }).click();
    await page.getByRole("checkbox", { name: /sample\/handoffs/ }).check();
    await page.getByRole("button", { name: sv ? "Visa översikt" : "Show overview", exact: true }).click();

    const card = page.locator(".issue-card.progress").filter({ hasText: "Finished handoff" });
    const badge = card.locator(".integration-wait");
    await expect(badge).toHaveText(variant.waiting);
    await expect(badge).toHaveAttribute("title", new RegExp(`${variant.active} 50m`));
    await expect(card.locator(".timer")).toHaveCount(0);
    await expect(card).not.toHaveClass(/issue-timeout/);
    await expect(card.locator('.label[title="integration-ready"]')).toHaveCount(0);
    await expect(card.locator('.label[title="orkester: fixture-session"]')).toHaveCount(1);
    // Active integration continues without its wait: 10 min before + 5 min now.
    const resumed = page.locator(".issue-card.progress").filter({ hasText: "Active integration" });
    await expect(resumed.locator(".timer")).toContainText("15m");
    await expect(resumed.locator(".integration-wait")).toHaveCount(0);
    // Closed issues stay Closed and do not show the waiting indicator.
    await expect(page.locator(".issue-card.closed").filter({ hasText: "Integrated earlier" }).locator(".integration-wait")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const tag = `${vp.name}-${variant.language}-${variant.theme}`;
    if (shots) await card.screenshot({ path: `${shots}/${tag}-card.png` });
    if (shots) await page.screenshot({ path: `${shots}/${tag}-cards.png` });

    await page.getByRole("button", { name: variant.list, exact: true }).first().click();
    const row = page.locator(".issue-row.progress").filter({ hasText: "Finished handoff" });
    const rowBadge = row.locator(".integration-wait");
    await expect(rowBadge).toBeVisible();
    await expect(rowBadge.locator(".sr-only")).toHaveText(variant.waiting);
    await expect(rowBadge).toHaveAttribute("title", new RegExp(variant.active));
    await expect(row.locator(".row-time .timer")).toHaveCount(0);
    await expect(row.locator(".row-timeout")).toHaveCount(0);
    const box = await rowBadge.boundingBox(), time = await row.locator(".row-time").boundingBox();
    expect(box!.height).toBeLessThanOrEqual(24);
    expect(box!.x + box!.width).toBeLessThanOrEqual(time!.x + time!.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (shots) await row.screenshot({ path: `${shots}/${tag}-row.png` });
    if (shots) await page.screenshot({ path: `${shots}/${tag}-list.png` });
    await context.close();
  });
}
