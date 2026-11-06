import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// #421: hourly catalog discovery and progressive picker icons. Synthetic data only.
const evidence = "docs/verification/421";
const artwork = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><circle cx="32" cy="32" r="13" fill="#f5f3e9"/></svg>`;
const long = "an-exceptionally-long-synthetic-repository-name-that-must-wrap-cleanly-in-the-picker";
const make = (index: number, name: string) => ({
  id: index, name, full_name: `synthetic-organisation/${name}`, owner: { login: "synthetic-organisation" }, private: index % 3 === 0,
  description: index % 4 === 1 ? "" : `Synthetic fixture project ${index} with a description long enough to be truncated on narrow screens`,
  html_url: `https://github.com/synthetic-organisation/${name}`,
});
const base = Array.from({ length: 40 }, (_, index) => make(index + 1, index === 1 ? long : `project-${String(index + 1).padStart(2, "0")}`));

async function fixture(page: Page) {
  const catalog = [...base];
  const reads: string[] = [];
  let inFlight = 0, maxInFlight = 0, catalogRequests = 0;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "synthetic-user", avatar_url: "" } });
    if (url.pathname === "/user/repos") { catalogRequests++; return route.fulfill({ json: catalog }); }
    if (url.pathname.includes("/contents")) {
      reads.push(url.pathname);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 150));
      inFlight--;
      const repo = catalog.find(item => url.pathname.startsWith(`/repos/${item.full_name}/`));
      // Every third project has artwork; the rest keep the quiet initials fallback.
      if (!repo || repo.id % 3 !== 1) return route.fulfill({ json: [] });
      if (url.pathname.endsWith("/contents")) return route.fulfill({ json: [{ type: "file", name: "favicon.svg", path: "favicon.svg", size: 300 }] });
      const svg = artwork(["#147d69", "#6644aa", "#b5651d"][repo.id % 3]!);
      return route.fulfill({ json: { type: "file", name: "favicon.svg", path: "favicon.svg", size: svg.length, encoding: "base64", content: Buffer.from(svg).toString("base64") } });
    }
    return route.fulfill({ json: [] });
  });
  return {
    reads, add(repo: typeof base[number]) { catalog.unshift(repo); },
    get maxInFlight() { return maxInFlight; }, get catalogRequests() { return catalogRequests; },
  };
}
async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("synthetic-picker-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  await expect(picker).toBeVisible();
  return picker;
}

test("picker looks up icons for shown rows only, three at a time, and reuses the cache", async ({ page }) => {
  const api = await fixture(page);
  const picker = await signIn(page);
  const first = picker.locator('.repo-option[data-picker-repository="synthetic-organisation/project-01"] .project-icon img');
  await expect(first).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(picker.locator('.repo-option[data-picker-repository="synthetic-organisation/project-03"] .project-icon-initials')).toHaveText("PR");
  await expect.poll(() => new Set(api.reads.map(path => path.split("/").slice(2, 4).join("/"))).size).toBeGreaterThan(3);
  await page.waitForTimeout(800);
  const looked = new Set(api.reads.map(path => path.split("/").slice(2, 4).join("/")));
  expect(looked.size).toBeLessThan(base.length);
  expect(looked.has("synthetic-organisation/project-40")).toBe(false);
  expect(api.maxInFlight).toBeLessThanOrEqual(3);
  // Scrolling reveals more rows progressively.
  await picker.locator('.repo-option[data-picker-repository="synthetic-organisation/project-40"]').scrollIntoViewIfNeeded();
  await expect.poll(() => api.reads.some(path => path.includes("/project-40/"))).toBe(true);
  // Reopening reuses the resolver cache: no new reads for rows already checked.
  await picker.getByRole("checkbox", { name: /project-01/ }).check();
  await picker.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(picker).toBeHidden();
  const before = api.reads.length;
  await page.locator(".sidebar-add").click();
  await expect(picker).toBeVisible();
  await picker.locator('.repo-option[data-picker-repository="synthetic-organisation/project-40"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  expect(api.reads.length).toBe(before);
  expect(api.maxInFlight).toBeLessThanOrEqual(3);
});

test("an hourly check adds new repositories without selecting them or changing the selection", async ({ page }) => {
  await page.clock.install();
  const api = await fixture(page);
  const picker = await signIn(page);
  await picker.getByRole("checkbox", { name: /project-05/ }).check();
  await picker.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(picker).toBeHidden();
  const initial = api.catalogRequests;
  await page.clock.fastForward("30:00");
  expect(api.catalogRequests).toBe(initial);
  api.add(make(99, "newly-shared-project"));
  await page.clock.fastForward("31:00");
  await expect.poll(() => api.catalogRequests).toBe(initial + 1);
  await page.clock.fastForward("05:00");
  expect(api.catalogRequests).toBe(initial + 1);
  await page.locator(".sidebar-add").click();
  await expect(picker.getByRole("checkbox", { name: /newly-shared-project/ })).not.toBeChecked();
  await expect(picker.getByRole("checkbox", { name: /project-05/ })).toBeChecked();
  await expect(picker.locator(".modal-footer")).toContainText("1 valda");
});

for (const viewport of [{ name: "desktop", width: 1600, height: 1000, phone: false }, { name: "mobile", width: 390, height: 844, phone: true }]) {
  for (const theme of ["light", "dark"] as const) {
    test(`picker layout ${viewport.name} ${theme}`, async ({ browser }: { browser: Browser }) => {
      const context = await browser.newContext({ viewport, locale: "sv-SE", colorScheme: theme, ...(viewport.phone ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      await fixture(page);
      const picker = await signIn(page);
      await expect(picker.locator('.repo-option[data-picker-repository="synthetic-organisation/project-01"] .project-icon img')).toBeVisible();
      await expect(picker.locator('.repo-option[data-picker-repository="synthetic-organisation/project-04"] .project-icon img')).toBeVisible();
      await page.keyboard.press("Tab");
      // Row geometry: icon slot and text start align across rows; no horizontal overflow.
      const rows = await picker.locator(".repo-option:not(.external-repo-option)").evaluateAll(elements => elements.slice(0, 6).map(row => {
        const icon = row.querySelector(".project-icon")!.getBoundingClientRect(), text = row.querySelector(".repo-option-text")!.getBoundingClientRect(), box = row.getBoundingClientRect();
        return { iconLeft: icon.left, textLeft: text.left, iconWidth: icon.width, right: text.right, rowRight: box.right, scroll: row.scrollWidth - row.clientWidth };
      }));
      for (const row of rows) {
        expect(Math.abs(row.iconLeft - rows[0]!.iconLeft)).toBeLessThanOrEqual(1);
        expect(Math.abs(row.textLeft - rows[0]!.textLeft)).toBeLessThanOrEqual(1);
        expect(row.iconWidth).toBe(20);
        expect(row.right).toBeLessThanOrEqual(row.rowRight + 1);
        expect(row.scroll).toBeLessThanOrEqual(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/picker-${viewport.name}-${theme}.png` });
      await context.close();
    });
  }
}
