import { expect, test, type Page } from "@playwright/test";

async function connect(page: Page) {
  let requests = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    // Scrolling may lazily request parent metadata; navigation must not refetch the board.
    if (url.pathname !== "/graphql") requests++;
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "navigation-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = [{
      id: 1, name: "alpha", full_name: "sample/alpha", private: false, description: "Fixture repository",
      html_url: "https://github.com/sample/alpha", owner: { login: "sample" },
    }];
    if (url.pathname.endsWith("/issues") && url.searchParams.get("state") === "open") {
      const date = new Date().toISOString();
      data = Array.from({ length: 8 }, (_, index) => ({
        id: index + 1, number: index + 1, title: `Keep task ${index + 1}`, body: "Fixture",
        comments: 0, state: "open", labels: [], assignees: [], created_at: date,
        updated_at: date, closed_at: null, html_url: `https://github.com/sample/alpha/issues/${index + 1}`,
      }));
    }
    await route.fulfill({ json: data });
  });
  // A controlled clock makes the sync scheduler's 1-second ticks deterministic (#142).
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-navigation-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: /^sample\/alpha/ }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
  return () => requests;
}

for (const width of [390, 1440]) {
  test(`overview navigates within the current board at ${width}px without changing session or filters`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const requests = await connect(page);
    const search = page.getByRole("textbox", { name: "Sök issues" });
    await search.fill("Keep");
    await expect(page.locator(".issue-title")).toHaveCount(6);
    // Closing the picker lets the sync scheduler request its first reconcile on the next tick. It is
    // skipped when that tick lands during the full load and sends one `since` list otherwise (#142).
    // Fire that tick now, wait for it, and keep time paused so only navigation can add requests.
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
    await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
    const beforeNavigation = requests();
    await page.evaluate(() => {
      Object.assign(window, { documentMarker: "same-document" });
      window.scrollTo(0, document.body.scrollHeight);
    });
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(150);
    const overview = page.getByRole("link", { name: "Översikt", exact: true });
    await expect(overview).toHaveAttribute("aria-current", "page");
    await overview.click();
    await expect(page).toHaveURL(/#overview$/);
    await expect(page.locator("main")).toBeFocused();
    // On phones main lands just below the sticky header (#145); on desktop at the top.
    expect(await page.locator("main").evaluate(element => Math.abs(element.getBoundingClientRect().top
      - (innerWidth <= 650 ? document.querySelector(".topbar")!.getBoundingClientRect().bottom : 0)))).toBeLessThanOrEqual(1);
    await expect(search).toHaveValue("Keep");
    await expect(page.locator(".issue-title")).toHaveCount(6);
    await expect(page.getByRole("button", { name: "Logga ut", exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { documentMarker: string }).documentMarker)).toBe("same-document");
    // Timers started by navigation still run; the scheduler's next reconcile is minutes away.
    await page.clock.runFor(5000);
    await expect(page.locator(".updated")).toHaveAttribute("aria-busy", "false");
    expect(requests()).toBe(beforeNavigation);
    // Keyboard activation also moves focus and the viewport back to the overview.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await overview.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    // On phones main lands just below the sticky header (#145); on desktop at the top.
    expect(await page.locator("main").evaluate(element => Math.abs(element.getBoundingClientRect().top
      - (innerWidth <= 650 ? document.querySelector(".topbar")!.getBoundingClientRect().bottom : 0)))).toBeLessThanOrEqual(1);
  });
}

test("overview keeps the welcome screen available and follows the selected language", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  const overview = page.getByRole("link", { name: "Översikt", exact: true });
  await expect(overview).not.toHaveAttribute("aria-current", "page");
  await overview.click();
  await expect(page.getByRole("heading", { name: /Följ dina AI-agenter/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Anslut GitHub", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
});
