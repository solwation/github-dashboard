import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const evidence = process.env.SIDEBAR_LAYOUT_EVIDENCE;
const before = process.env.SIDEBAR_LAYOUT_BEFORE === "1";
const scenarios = [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }, { width: 1000, height: 1100, touch: true }, { width: 950, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }];
async function fixture(page: Page, mobile: boolean) {
  await page.goto("/");
  await page.evaluate(async mobile => {
    const vuePath = "/node_modules/.vite/deps/vue.js", sidebarPath = "/src/components/SidebarRepositories.vue", iconsPath = "/src/composables/useProjectIcon.ts", namesPath = "/src/lib/repository-display-name.ts";
    const [{ createApp, h, ref }, { default: SidebarRepositories }, { provideProjectIcons }, { sidebarRepositoryDisplayName }] = await Promise.all([import(vuePath), import(sidebarPath), import(iconsPath), import(namesPath)]);
    const host = document.querySelector("#app") as HTMLElement & { __vue_app__?: { unmount: () => void } };
    host.__vue_app__?.unmount();
    const rows = [
      { id: 1, fullName: "sample/alpha", name: "alpha", backlog: 1234, progress: 12, closed: 98, private: true },
      { id: 2, fullName: "sample/a-very-long-project-name-that-needs-ellipsis", name: "a-very-long-project-name-that-needs-ellipsis", backlog: 1, progress: 0, closed: 3, pagesUrl: "https://sample.github.io/example/" },
      { id: 3, fullName: "sample/quiet", name: "quiet", backlog: 0, progress: 0, closed: 0 },
      { id: 4, fullName: "other/alpha", name: "alpha", backlog: 8, progress: 2, closed: 5, external: true, private: false },
    ].map((row, index) => ({ ...row, changedAt: index === 0 ? new Date().toISOString() : null, unreadAt: index === 0 ? new Date().toISOString() : null }));
    const mode = ref("auto"), hidden = ref(false), selected = ref("sample/alpha");
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    const paint = canvas.getContext("2d")!; paint.fillStyle = "#147d69"; paint.fillRect(0, 0, 64, 64); paint.fillStyle = "white"; paint.fillRect(14, 14, 10, 36); paint.fillRect(36, 14, 10, 36);
    const repositories = rows.map((row, index) => ({ full_name: row.fullName, ...(index === 0 ? { projectIcon: { data: canvas.toDataURL(), checkedAt: Date.now() } } : {}) }));
    const component = { setup() {
      provideProjectIcons(() => repositories, () => ({}));
      return () => h("div", [
        h("aside", { class: ["sidebar", { "sidebar-mobile-open": mobile }] }, [
          h("div", { class: "brand" }, [h("span", { class: "brand-icon" }, "I"), h("span", "Issueflow")]),
          h("span", { class: "nav-caption" }, "WORKSPACE"),
          h("nav", { class: "workspace-navigation" }, [h("a", { class: "nav-item", href: "#overview" }, "Översikt")]),
          h(SidebarRepositories, { repos: rows.map(row => ({ ...row, name: sidebarRepositoryDisplayName(row.fullName, rows.map(item => item.fullName), mode.value) })), canSelect: true, selectedRepository: selected.value, visibility: { "sample/alpha": "visible", "sample/a-very-long-project-name-that-needs-ellipsis": hidden.value ? "visible" : "hidden", "sample/quiet": "inactive", "other/alpha": "visible" }, onToggleVisibility: () => { hidden.value = !hidden.value; }, onActivate: (name: string) => { selected.value = name; } }),
        ]),
        h("main", { class: "workspace" }, "Synthetic sidebar layout fixture"),
      ]);
    } };
    createApp(component).mount(host);
    (window as any).sidebarLayoutFixture = { setMode: (value: string) => { mode.value = value; } };
  }, mobile);
  if (mobile || await page.viewportSize()!.width > 950) await expect(page.locator(".sidebar-repository-row")).toHaveCount(4);
}

test("sidebar project rows use full-height artwork and a small inset across themes, owner modes and touch layouts", async ({ browser }) => {
  const measurements: unknown[] = [];
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const viewport of scenarios) {
    const mobile = viewport.width < 651 || viewport.height < 501 || viewport.touch === true;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); await fixture(page, mobile);
    if (viewport.width === 950) {
      await expect(page.locator(".sidebar-projects")).toBeHidden();
      expect((await page.locator(".sidebar").boundingBox())!.width).toBe(70);
    }
    for (const mode of ["auto", "yes", "no"]) {
      await page.evaluate(mode => (window as any).sidebarLayoutFixture.setMode(mode), mode);
      for (const theme of ["light", "dark"]) {
        await page.evaluate(async theme => { const modulePath = "/src/lib/theme.ts"; (await import(modulePath)).setTheme(theme); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }, theme);
        const geometry = await page.evaluate(() => {
          const sidebar = document.querySelector(".sidebar")!.getBoundingClientRect();
          const rect = (element: Element) => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; };
          const rows = [...document.querySelectorAll(".sidebar-repository-row")].filter(row => row.getBoundingClientRect().height > 0).map(row => {
            const link = row.querySelector(".sidebar-repository")!, icon = row.querySelector(".project-icon")!, label = row.querySelector(".repository-label")!, counts = row.querySelector(".repository-counts")!;
            const box = rect(row), image = rect(icon);
            return { repository: row.getAttribute("data-repository"), row: box, link: rect(link), icon: image, leftInset: box.left - sidebar.left, rightInset: sidebar.right - box.right, label: rect(label), counts: rect(counts), countsFit: [...row.querySelectorAll(".status-count-value")].every(value => value.scrollWidth <= value.clientWidth), labelEllipsis: getComputedStyle(label).textOverflow, controls: [...row.querySelectorAll(".repo-pages,.repo-github,.repo-board-toggle")].filter(element => element.getBoundingClientRect().width > 0).map(element => rect(element)), dot: rect(icon.querySelector(".project-icon-color")!) };
          });
          return { sidebar: rect(document.querySelector(".sidebar")!), overflow: document.documentElement.scrollWidth - innerWidth, sidebarOverflow: document.querySelector(".sidebar")!.scrollWidth - document.querySelector(".sidebar")!.clientWidth, rows };
        });
        expect(geometry.overflow).toBeLessThanOrEqual(0); expect(geometry.sidebarOverflow).toBeLessThanOrEqual(0);
        for (const row of geometry.rows) {
          expect(row.labelEllipsis).toBe("ellipsis");
          if (!before) expect(row.countsFit, row.repository + " counts stay readable").toBe(true);
          expect(Math.abs(row.label.left - row.counts.left)).toBeLessThanOrEqual(1);
          for (const control of row.controls) { expect(control.right).toBeLessThanOrEqual(row.row.right + 1); expect(control.left).toBeGreaterThanOrEqual(row.label.right - 1); if (mobile) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); } }
          if (!before) {
            expect(Math.abs(row.icon.height - row.row.height)).toBeLessThanOrEqual(1); expect(row.icon.width).toBe(row.icon.height);
            expect(Math.abs(row.icon.top - row.row.top)).toBeLessThanOrEqual(1); expect(Math.abs(row.icon.left - row.row.left)).toBeLessThanOrEqual(1);
            expect(row.leftInset).toBeLessThanOrEqual(5); expect(row.rightInset).toBeLessThanOrEqual(5);
            expect(row.row.height).toBeLessThanOrEqual(mobile ? 52 : 44);
          }
        }
        if (geometry.rows.length) {
          expect(Math.max(...geometry.rows.map(row => row.label.left)) - Math.min(...geometry.rows.map(row => row.label.left))).toBeLessThanOrEqual(1);
          if (mode === "auto" && theme === "light") { await page.locator(".sidebar-repository").first().focus(); await page.keyboard.press("Enter"); await expect(page.locator('.sidebar-repository[aria-current="true"]')).toHaveCount(1); }
        }
        measurements.push({ viewport, mobile, mode, theme, ...geometry });
        if (evidence && mode === "yes") await page.screenshot({ path: `${evidence}/${before ? "before" : "after"}-${viewport.width}x${viewport.height}-${theme}.png` });
      }
    }
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/${before ? "before" : "after"}-geometry.json`, JSON.stringify(measurements, null, 2));
});

test("sidebar artwork sizing leaves content Cards/List and repository headings at16/20px", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const width = (selector: string) => page.locator(selector).evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().width).map(element => element.getBoundingClientRect().width));
  await expect(page.locator(".issue-card")).not.toHaveCount(0);
  expect((await width(".issue-card .project-icon")).every(value => value === 16)).toBe(true);
  expect((await width(".lane-title .project-icon")).every(value => value === 20)).toBe(true);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck(); await page.getByRole("button", { name: "Lista", exact: true }).click();
  expect((await width(".issue-row .project-icon")).every(value => value === 16)).toBe(true);
});
