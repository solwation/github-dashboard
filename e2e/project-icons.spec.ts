import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const evidence = process.env.PROJECT_ICON_EVIDENCE;
const artwork = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><path d="M21 15v34h25v-7H29V15Z" fill="#f5f3e9"/></svg>`;
const repos = [
  { id: 1, full_name: "sample/alpha", name: "alpha", owner: { login: "sample" } },
  { id: 2, full_name: "sample/long-project-without-an-icon", name: "long-project-without-an-icon", owner: { login: "sample" } },
  { id: 3, full_name: "other/alpha", name: "alpha", owner: { login: "other" } },
].map(repo => ({ ...repo, private: true, description: "Synthetic project icon fixture with a long repository description", html_url: `https://github.com/${repo.full_name}` }));
async function fixture(page: Page, initiallyMissing = false) {
  let missing = initiallyMissing;
  const reads: string[] = [];
  let revision = false;
  let login = "icons-one", blocked = false, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    const repo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
    if (url.pathname.includes("/contents")) {
      reads.push(url.pathname);
      if (blocked) await pending;
      if (repo?.id === 2 || (repo?.id === 1 && missing)) return route.fulfill({ json: [] });
      if (url.pathname.endsWith("/contents")) return route.fulfill({ json: [{ type: "file", name: "favicon.svg", path: "favicon.svg", size: 300, download_url: "https://untrusted.invalid/never-fetch" }] });
      const svg = artwork(login === "icons-one" ? "#147d69" : "#6644aa");
      return route.fulfill({ json: { type: "file", name: "favicon.svg", path: "favicon.svg", size: svg.length, encoding: "base64", content: Buffer.from(svg).toString("base64"), download_url: "https://untrusted.invalid/never-fetch" } });
    }
    const now = Date.now(), iso = (at: number) => new Date(at).toISOString();
    const event = url.pathname.match(/\/issues\/(\d+)\/events$/);
    if (event && repo) {
      const number = Number(event[1]);
      const started = number === 11 ? now - 40 * 60000 : number === 12 && revision ? now - 10 * 60000 : null;
      return route.fulfill({ json: started ? [{ id: number, event: "labeled", label: { name: "in-progress" }, created_at: iso(started) }] : [] });
    }
    if (repo && url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      const open = { id: repo.id, number: 10 + repo.id, title: `Synthetic task in ${repo.full_name}: a long title to check compact card and row geometry`, state: "open", body: "Synthetic issue body", comments: revision ? 2 : 1,
        labels: [{ name: "priority: medium", color: "d4c5f9" }, { name: "a-long-synthetic-label-for-layout", color: "d4c5f9" }, ...(repo.id === 1 || (repo.id === 2 && revision) ? [{ name: "in-progress", color: "147d69" }] : [])],
        assignees: [], created_at: iso(now - 86400000), updated_at: iso(revision ? now : now - 3600000), closed_at: null, html_url: `${repo.html_url}/issues/${10 + repo.id}` };
      const closed = [1, 2, 3].map(index => ({ id: repo.id * 100 + index, number: repo.id * 100 + index, title: `Synthetic completed history ${repo.full_name} ${index}`, state: "closed", body: "", labels: [], assignees: [], created_at: iso(now - 100 * 60000), updated_at: iso(now - 60 * 60000), closed_at: iso(now - 60 * 60000), startedAt: iso(now - 80 * 60000), workStartedAt: iso(now - 80 * 60000), html_url: `${repo.html_url}/issues/${repo.id * 100 + index}` }));
      return route.fulfill({ json: url.searchParams.get("state") === "closed" ? closed : url.searchParams.get("state") === "all" ? [open, ...closed] : [open] });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("https://untrusted.invalid/**", () => { throw new Error("Project artwork must never make an external request"); });
  await page.goto("/");
  return { reads, showIcon() { missing = false; }, advance() { revision = true; }, account(value: string) { login = value; }, hold() { blocked = true; }, release() { blocked = false; release(); } };
}
async function signIn(page: Page) {
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("synthetic-project-icons-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  await expect.poll(async () => await picker.isVisible() || await page.locator(".issue-card").count() === 12).toBe(true);
  if (await picker.isVisible()) {
    for (const repo of repos) await picker.getByRole("checkbox", { name: repo.full_name }).check();
    await picker.getByRole("button", { name: "Visa översikt", exact: true }).click();
  }
  await expect(page.locator(".issue-card")).toHaveCount(12);
}
const firstIcon = (page: Page) => page.locator('.sidebar-repository-row[data-repository="sample/alpha"] .project-icon');
async function signOut(page: Page) {
  if (await page.locator(".mobile-menu-button").isVisible()) await page.locator(".mobile-menu-button").click();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
}

test("manual project refresh recovers the existing L artwork after a cached miss", async ({ page }) => {
  const api = await fixture(page, true); await signIn(page);
  await expect(firstIcon(page).locator(".project-icon-initials")).toHaveText("AL");
  await expect(page.locator('.sidebar-repository-row[data-repository="other/alpha"] .project-icon img')).toBeVisible();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  const before = [...api.reads];
  api.showIcon();
  await page.getByRole("button", { name: /Klicka för att uppdatera sample\/alpha nu/ }).click();
  await expect(firstIcon(page).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(api.reads.filter(path => path.includes("/other/alpha/")).length).toBe(before.filter(path => path.includes("/other/alpha/")).length);
  expect(api.reads.filter(path => path.includes("/sample/long-project-without-an-icon/")).length).toBe(before.filter(path => path.includes("/sample/long-project-without-an-icon/")).length);
  await expect.poll(() => api.reads.length).toBe(before.length + 2);
  if (evidence) await page.screenshot({ path: `${evidence}/recovered-l-icon.png`, fullPage: true });
});

test("project icon resolver uses safe artwork, caches across reload, falls back on missing/broken images and isolates accounts", async ({ page }) => {
  const api = await fixture(page); await signIn(page);
  await expect(firstIcon(page).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  const original = await firstIcon(page).locator("img").getAttribute("src");
  await expect(page.locator('.sidebar-repository-row[data-repository="sample/long-project-without-an-icon"] .project-icon')).toHaveText("LO");
  await expect(page.locator('.sidebar-repository-row[data-repository="other/alpha"] .project-icon img')).toHaveAttribute("src", /^data:image\/png;base64,/);
  // The first icon can render before later projects finish discovery and encrypted persistence.
  await expect.poll(() => page.evaluate(async () => {
    const modulePath = "/src/lib/content-cache.ts";
    const { readSnapshot } = await import(modulePath);
    const snapshot = await readSnapshot("synthetic-project-icons-token");
    return snapshot?.repos.filter((repo: { projectIcon?: unknown }) => repo.projectIcon !== undefined).length;
  })).toBe(3);
  expect(api.reads.length).toBe(5);
  await page.reload();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  expect(api.reads.length).toBe(5);
  // An image decoder failure keeps the same reserved box and readable initials.
  await firstIcon(page).locator("img").dispatchEvent("error");
  await expect(firstIcon(page)).toHaveText("AL");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("data:image");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("sample/");
  await page.reload();
  await expect(firstIcon(page).locator("img")).toHaveAttribute("src", original!);
  expect(api.reads.length).toBe(5);
  await signOut(page); api.account("icons-two"); await signIn(page);
  await expect(firstIcon(page).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  expect(await firstIcon(page).locator("img").getAttribute("src")).not.toBe(original);
});

const scenarios = process.env.PROJECT_ICON_MATRIX === "1" ? [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }] : [{ width: 1600, height: 1000 }, { width: 390, height: 844 }];
test("project icon design matrix keeps fixed boxes, compact cards/list, overlay colors and no overflow", async ({ browser }) => {
  const measurements: unknown[] = [];
  for (const viewport of scenarios) {
    const mobile = viewport.width < 651 || viewport.height < 501;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); const api = await fixture(page); await signIn(page);
    api.advance(); await page.keyboard.press("Control+r");
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    await expect(page.locator(".issue-timeout")).not.toHaveCount(0);
    await expect(page.locator(".unread-move")).not.toHaveCount(0);
    await expect(page.locator(".new-comments-badge")).not.toHaveCount(0);
    await expect(firstIcon(page).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
    for (const split of [true, false]) {
      await page.getByRole("checkbox", { name: "Dela upp per repository" }).setChecked(split);
      for (const list of [false, true]) {
        await page.getByRole("button", { name: list ? "Lista" : "Kort", exact: true }).click();
        for (const theme of ["light", "dark"]) {
          await page.evaluate(async theme => {
            const modulePath = "/src/lib/theme.ts";
            const { setTheme } = await import(modulePath); setTheme(theme);
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          }, theme);
          await page.evaluate(() => window.scrollTo(0, 0));
          const stats = await page.evaluate(() => {
            const visible = (element: Element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
            const icons = [...document.querySelectorAll(".project-icon")].filter(visible).map(element => {
              const box = element.getBoundingClientRect(), dot = element.querySelector(".project-icon-color")!.getBoundingClientRect();
              return { width: box.width, height: box.height, colorRight: dot.right - box.right, colorBottom: dot.bottom - box.bottom };
            });
            const rows = [...document.querySelectorAll(".issue-row")].filter(visible).map(element => element.getBoundingClientRect().height);
            const rowIds = [...document.querySelectorAll(".issue-row .row-id")].filter(visible).map(element => element.getBoundingClientRect().left);
            return { overflow: document.documentElement.scrollWidth - innerWidth, rootBackground: getComputedStyle(document.documentElement).backgroundColor, bodyBackground: getComputedStyle(document.body).backgroundColor, colorScheme: getComputedStyle(document.documentElement).colorScheme, icons, rowHeights: rows, rowIds };
          });
          expect(stats.overflow).toBeLessThanOrEqual(0);
          expect(stats.colorScheme).toBe(theme);
          if (theme === "dark") expect(stats.rootBackground).toBe("rgb(15, 23, 25)");
          for (const icon of stats.icons) { expect([16, 20]).toContain(icon.width); expect(icon.height).toBe(icon.width); expect(Math.abs(icon.colorRight)).toBeLessThanOrEqual(1); expect(Math.abs(icon.colorBottom)).toBeLessThanOrEqual(1); }
          if (list && !split && stats.rowIds.length) expect(Math.max(...stats.rowIds) - Math.min(...stats.rowIds)).toBeLessThanOrEqual(1);
          measurements.push({ viewport, mobile, split, list, theme, ...stats });
          if (evidence) await page.screenshot({ path: `${evidence}/icons-${viewport.width}x${viewport.height}-${split ? "split" : "combined"}-${list ? "list" : "cards"}-${theme}.png`, fullPage: true });
        }
      }
    }
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/project-icon-geometry.json`, JSON.stringify(measurements, null, 2));
});
