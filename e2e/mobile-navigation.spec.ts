import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const sizes = [
  { width: 390, height: 844, mobile: true },
  { width: 320, height: 568, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 1000, height: 900, mobile: false },
  { width: 1600, height: 1000, mobile: false },
] as const;

async function enterDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
}

async function countVisibleRows(page: Page, reservedHeaderHeight: number) {
  const first = page.locator(".issue-row").first();
  await first.evaluate(element => element.scrollIntoView({ block: "start" }));
  return page.evaluate((top) => {
    return [...document.querySelectorAll<HTMLElement>(".issue-row")].filter(row => {
      const box = row.getBoundingClientRect();
      return box.top >= top && box.bottom <= innerHeight;
    }).length;
  }, reservedHeaderHeight);
}

test("compact navigation and Cards/List viewport matrix", async ({ browser }, info) => {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: "sv-SE",
    });
    const page = await context.newPage();
    await enterDemo(page);
    const mobile = size.mobile;
    if (mobile) {
      const header = page.locator(".topbar");
      await expect(header).toBeVisible();
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(80);
      await expect(page.locator(".mobile-navigation")).toBeVisible();
      await expect(page.locator(".mobile-menu-button")).toBeVisible();
      await page.getByRole("button", { name: "Meny" }).click();
      await expect(page.locator(".topbar-right").getByRole("button", { name: "Inställningar" })).toBeVisible();
      await expect(page.locator(".topbar-right").getByRole("button", { name: "Installera app" })).toBeVisible();
      await page.getByRole("button", { name: "Meny" }).click();
      await page.locator(".mobile-navigation").getByRole("link", { name: "Statistik" }).click();
      await expect(page.locator(".topbar .breadcrumb strong")).toHaveText("Statistik");
      await page.getByRole("button", { name: "Sök issues" }).click();
      await expect(page.getByRole("textbox", { name: "Sök issues" })).toBeFocused();
    }

    for (const mode of ["Kort", "Lista"] as const) {
      const toggle = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
      await toggle.getByRole("button", { name: mode, exact: true }).click();
      await page.locator(mode === "Lista" ? ".issue-row" : ".issue-card").first().scrollIntoViewIfNeeded();
      const header = page.locator(".topbar");
      const headerHeight = (await header.boundingBox())!.height;
      const baselineHeaderHeight = size.width === 320 ? 212 : size.width === 390 ? 167 : 80;
      const rowCount = mode === "Lista" ? await countVisibleRows(page, headerHeight) : null;
      const baselineRowCount = mode === "Lista" && mobile ? await countVisibleRows(page, baselineHeaderHeight) : null;
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: info.outputPath(`viewport-${size.width}x${size.height}-${mode === "Lista" ? "list" : "cards"}.png`),
        fullPage: false,
      });
      if (mobile && mode === "Lista") {
        console.log(JSON.stringify({ viewport: `${size.width}x${size.height}`, oldHeaderHeight: baselineHeaderHeight, headerHeight, oldCompleteRows: baselineRowCount, completeRows: rowCount }));
      }
      if (size.width === 320 && mode === "Lista") {
        await page.evaluate(() => { document.documentElement.style.fontSize = "24px"; });
        await page.getByRole("button", { name: "Meny" }).click();
        await expect(page.locator(".mobile-tools")).toHaveClass(/mobile-tools-open/);
        await page.setViewportSize({ width: 320, height: 260 }); // Short visual viewport while a mobile keyboard is open.
        const menu = page.locator("#mobile-tools-menu");
        await expect(menu).toBeVisible();
        const menuBounds = (await menu.boundingBox())!;
        expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(260);
        expect(await menu.evaluate(element => element.scrollHeight >= element.clientHeight)).toBe(true);
        await menu.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await expect(menu.getByRole("button", { name: "Till inloggning", exact: true })).toBeInViewport();
        await page.getByRole("button", { name: "Meny" }).click();
        await page.getByRole("button", { name: "Sök issues" }).click();
        const search = page.getByRole("textbox", { name: "Sök issues" });
        await expect(search).toBeFocused();
        await search.evaluate(element => element.scrollIntoView({ block: "center" }));
        const target = await search.boundingBox();
        const stickyBounds = (await page.locator(".topbar").boundingBox())!;
        const stickyBottom = stickyBounds.y + stickyBounds.height;
        expect(target!.y).toBeGreaterThanOrEqual(stickyBottom - 1);
        expect(target!.y + target!.height).toBeLessThanOrEqual(260);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }
    await context.close();
  }
});

async function enterPublic(page: Page) {
  const repo = { id: 6243, name: "mobile-nav", full_name: "sample/mobile-nav", private: false, html_url: "https://github.com/sample/mobile-nav", description: "Fictional navigation fixture", owner: { login: "sample" } };
  const now = new Date(Date.now() - 3600000).toISOString();
  const issue = { id: 6243, number: 1, title: "A fictional issue used to check phone navigation", state: "open", labels: [], assignees: [], comments: 0, created_at: now, updated_at: now, closed_at: null, html_url: `${repo.html_url}/issues/1` };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/repos/sample/mobile-nav") return route.fulfill({ json: repo });
    if (url.pathname === "/user") return route.fulfill({ json: { login: "fictional-account", avatar_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='16' fill='%23147d69'/%3E%3C/svg%3E" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    return route.fulfill({ json: url.pathname.endsWith("/issues") && url.searchParams.get("state") !== "closed" ? [issue] : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Följ publika repositories", exact: true }).click();
  await page.getByLabel("Publikt repository", { exact: true }).fill("sample/mobile-nav");
  await page.getByRole("button", { name: "Lägg till repository", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: repo.full_name })).toBeChecked();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toContainText(issue.title);
}

test("public and signed-in account actions remain available on portrait and landscape phones", async ({ browser }, info) => {
  for (const size of [sizes[1], sizes[2]]) {
    const context: BrowserContext = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: true, hasTouch: true, locale: "sv-SE" });
    const page = await context.newPage();
    await enterPublic(page);
    await expect(page.locator(".topbar-right")).toBeHidden();
    await page.getByRole("button", { name: "Meny" }).click();
    await expect(page.locator(".topbar-right .account-timezone")).toBeVisible();
    await expect(page.locator(".topbar-right .account-timezone")).not.toBeEmpty();
    await expect(page.locator(".topbar-right").getByRole("button", { name: "Lämna publik vy", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`public-${size.width}x${size.height}.png`) });
    await page.getByRole("button", { name: "Lämna publik vy", exact: true }).click();
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-mobile-navigation-token");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "sample/mobile-nav" })).toBeVisible();
    await page.getByRole("checkbox", { name: "sample/mobile-nav" }).check();
    await page.getByRole("button", { name: "Visa översikt" }).click();
    await page.getByRole("button", { name: "Meny" }).click();
    await expect(page.locator(".topbar-right").getByRole("button", { name: "Logga ut", exact: true })).toBeVisible();
    await expect(page.locator(".topbar-right").getByRole("button", { name: "Öppna på mobilen" })).toBeVisible();
    await expect(page.locator(".topbar-right .username")).toHaveText("fictional-account");
    await expect(page.locator(".topbar-right").getByRole("button", { name: "Logga ut", exact: true })).toContainText("Logga ut");
    await page.screenshot({ path: info.outputPath(`signed-in-${size.width}x${size.height}.png`) });
    await context.close();
  }
});
