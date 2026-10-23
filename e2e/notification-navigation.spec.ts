import { expect, test, type Browser, type Page } from "@playwright/test";
import { repositoryNotification } from "./support/repository-properties";

// Clicking a status notice (#278) focuses the board and highlights the notified issue, even when it
// sits in a collapsed repository, beyond "Visa fler" or behind a search. Fictional fixtures only.
const repositories = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, private: false, description: "Fixture", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
const hour = 3600000;
const issue = (repo: typeof repositories[number], number: number, title: string, closedAt: string | null) => ({
  id: repo.id * 1000 + number, number, title, state: closedAt ? "closed" : "open", labels: [], assignees: [], comments: 0,
  created_at: "2026-01-01T00:00:00Z", updated_at: new Date().toISOString(), closed_at: closedAt, html_url: `${repo.html_url}/issues/${number}`,
});

async function fixture(browser: Browser, baseURL: string | undefined, device: { viewport: { width: number; height: number }; isMobile: boolean; hasTouch: boolean }, reducedMotion: "reduce" | "no-preference" = "no-preference") {
  const context = await browser.newContext({ ...device, baseURL, locale: "sv-SE", reducedMotion });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const notices: { title: string; onclick: ((event: Event) => void) | null }[] = [];
    class FakeNotification {
      static permission = "granted";
      static async requestPermission() { return "granted"; }
      onclick: ((event: Event) => void) | null = null;
      constructor(public title: string) { notices.push(this); }
      close() {}
    }
    Object.assign(window, { fakeNotices: notices, Notification: FakeNotification });
  });
  // The target closes with an older closed_at than ten other closures, so it lands beyond "Visa fler".
  const target = { open: true, closedAt: "" };
  let round = 0;
  const started = Date.now();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "notice-navigation", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repositories;
    else if (url.pathname.endsWith("/issues")) {
      const repo = repositories.find(item => url.pathname.includes(`/${item.name}/`))!;
      const all = [
        ...Array.from({ length: 10 }, (_, index) => issue(repo, 100 + index, `${repo.name} done ${index}`, new Date(started - (index + 1) * 60000).toISOString())),
        ...Array.from({ length: 3 }, (_, index) => issue(repo, 200 + index, `${repo.name} backlog ${index}`, null)),
        ...(repo.name === "alpha" ? [issue(repo, 7, "Notified target", target.open ? null : target.closedAt)] : []),
      ];
      const state = url.searchParams.get("state");
      data = all.filter(item => state === "all" || item.state === state);
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-notice-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repositories) await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  await repositoryNotification(page, "alpha", toggle => toggle.click());
  const refreshWhenIdle = async () => {
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    await page.keyboard.press("Control+r");
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  };
  const notices = () => page.evaluate(() => (window as unknown as { fakeNotices: { title: string }[] }).fakeNotices.length);
  /** Close the target in GitHub (fixture), let the board notice it and return the new notice's index. */
  const closeTarget = async () => {
    target.open = true;
    await refreshWhenIdle();
    const before = await notices();
    target.open = false;
    target.closedAt = new Date(Date.now() - 2 * hour - ++round * 60000).toISOString();
    await refreshWhenIdle();
    await expect.poll(notices).toBe(before + 1);
    expect(await page.evaluate(index => (window as unknown as { fakeNotices: { title: string }[] }).fakeNotices[index]!.title, before)).toBe("alpha · Issue stängd");
    return before;
  };
  const click = (index: number) => page.evaluate(index => {
    const notice = (window as unknown as { fakeNotices: { onclick: ((event: Event) => void) | null }[] }).fakeNotices[index]!;
    notice.onclick?.(new Event("click", { cancelable: true }));
  }, index);
  return { context, page, closeTarget, click };
}

async function setMode(page: Page, mode: "Cards" | "List") {
  await page.locator(".board-mode-toggle").locator(`[title="${mode === "List" ? "Lista" : "Kort"}"]`).click();
}

async function expectHighlighted(page: Page, selector: string, reducedMotion = false) {
  const target = page.locator(selector).filter({ hasText: "Notified target" });
  await expect(target).toHaveCount(1);
  await expect(target).toHaveClass(/issue-navigation-highlight/);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  const style = await target.evaluate(node => ({ outline: getComputedStyle(node).outlineStyle, animation: getComputedStyle(node).animationName }));
  expect(style.outline).toBe("solid");
  if (reducedMotion) expect(style.animation).toBe("none");
  else expect(style.animation).toContain("issue-navigation-pulse");
  return target;
}

const devices = [
  { name: "desktop", viewport: { width: 1600, height: 1000 }, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
for (const device of devices) for (const mode of ["Cards", "List"] as const) {
  test(`notification click highlights the issue in ${mode.toLowerCase()} on ${device.name}`, async ({ browser }, info) => {
    const { context, page, closeTarget, click } = await fixture(browser, info.project.use.baseURL, device);
    const item = mode === "List" ? ".issue-row" : ".issue-card";
    await setMode(page, mode);
    // Split board: the repository is collapsed and the target is the oldest of eleven closures.
    let notice = await closeTarget();
    await page.getByRole("button", { name: "Kollapsa alpha", exact: true }).click();
    await expect(page.locator("#repo-1")).toHaveClass(/is-collapsed/);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await click(notice);
    await expect(page.locator("#repo-1")).not.toHaveClass(/is-collapsed/);
    await expectHighlighted(page, `#repo-1 .closed ${item}`);
    await expect(page.locator(".sr-only[role=status]").filter({ hasText: "Visar #7 i sample/alpha" })).toHaveCount(1);
    await page.screenshot({ path: `/tmp/claude-0/worker278/${device.name}-${mode.toLowerCase()}-split.png` });

    // A search that hides the issue is cleared, and the announcement says so.
    notice = await closeTarget();
    const search = page.locator("#issue-search input");
    await search.fill("backlog");
    await expect(page.locator(`#repo-1 ${item}`).filter({ hasText: "Notified target" })).toHaveCount(0);
    await click(notice);
    await expect(search).toHaveValue("");
    await expectHighlighted(page, `#repo-1 .closed ${item}`);
    await expect(page.locator(".sr-only[role=status]").filter({ hasText: "Sökningen rensades så att issuet syns." })).toHaveCount(1);

    // Combined board: the target is again beyond the shared "Visa fler" limit.
    const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
    await split.uncheck();
    notice = await closeTarget();
    await page.evaluate(() => window.scrollTo(0, 0));
    await click(notice);
    await expectHighlighted(page, `#board-combined-closed ${item}`);
    await page.screenshot({ path: `/tmp/claude-0/worker278/${device.name}-${mode.toLowerCase()}-combined.png` });
    await context.close();
  });
}

test("notification highlight is a static frame with reduced motion", async ({ browser }, info) => {
  const { context, page, closeTarget, click } = await fixture(browser, info.project.use.baseURL, devices[0]!, "reduce");
  const notice = await closeTarget();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await click(notice);
  await expectHighlighted(page, "#repo-1 .closed .issue-card", true);
  await page.screenshot({ path: "/tmp/claude-0/worker278/desktop-cards-reduced-motion.png" });
  await context.close();
});

test("a worker notice's issue link opens Overview and highlights the issue", async ({ browser }, info) => {
  const { context, page } = await fixture(browser, info.project.use.baseURL, devices[1]!);
  await page.getByRole("button", { name: "Kollapsa alpha", exact: true }).click();
  await page.evaluate(() => { location.hash = "#statistics"; });
  await expect(page.locator(".statistics-view")).toBeVisible();
  // The service worker focuses the app and navigates it to this hash (#278).
  await page.evaluate(() => { location.hash = "#repo-1-issue-202"; });
  const target = page.locator("#repo-1 .backlog .issue-card").filter({ hasText: "alpha backlog 2" });
  await expect(target).toHaveClass(/issue-navigation-highlight/);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#overview");
  // An issue the board does not show falls back to its repository with an announcement.
  await page.evaluate(() => { location.hash = "#repo-2-issue-999"; });
  await expect(page.locator("#repo-2")).toHaveClass(/repository-navigation-highlight/);
  await expect(page.locator(".sr-only[role=status]").filter({ hasText: "#999 visas inte på tavlan. Visar sample/beta." })).toHaveCount(1);
  await context.close();
});

test("a notified issue the column cannot show falls back to its repository (#288)", async ({ browser }, info) => {
  const { context, page, closeTarget, click } = await fixture(browser, info.project.use.baseURL, devices[0]!);
  const notice = await closeTarget();
  // The issue is in the loaded data, but its card is not found in the rendered column.
  await page.evaluate(() => {
    const original = document.getElementById.bind(document);
    document.getElementById = (id: string) => /^issue-.*-7$/.test(id) ? null : original(id);
  });
  await click(notice);
  await expect(page.locator("#repo-1")).toHaveClass(/repository-navigation-highlight/);
  await expect(page.locator(".sr-only[role=status]").filter({ hasText: "#7 visas inte på tavlan. Visar sample/alpha." })).toHaveCount(1);
  await expect(page.locator(".sr-only[role=status]").filter({ hasText: "Visar #7 i sample/alpha" })).toHaveCount(0);
  await expect(page.locator(".issue-navigation-highlight")).toHaveCount(0);
  await context.close();
});
