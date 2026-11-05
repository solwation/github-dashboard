import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { boardSplit } from "./support/board-grouping";
const evidence = process.env.SIDEBAR_LAYOUT_EVIDENCE;
const before = process.env.SIDEBAR_LAYOUT_BEFORE === "1";
const scenarios = [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }, { width: 1000, height: 1100, touch: true }, { width: 950, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }];
async function fixture(page: Page, mobile: boolean, many = false) {
  await page.goto("/");
  await page.evaluate(async ({ mobile, many }) => {
    const vuePath = "/node_modules/.vite/deps/vue.js", sidebarPath = "/src/components/SidebarRepositories.vue", iconsPath = "/src/composables/useProjectIcon.ts", namesPath = "/src/lib/repository-display-name.ts";
    const [{ createApp, h, ref }, { default: SidebarRepositories }, { provideProjectIcons }, { sidebarRepositoryDisplayName }] = await Promise.all([import(vuePath), import(sidebarPath), import(iconsPath), import(namesPath)]);
    const host = document.querySelector("#app") as HTMLElement & { __vue_app__?: { unmount: () => void } };
    host.__vue_app__?.unmount();
    const rows = [
      { id: 1, fullName: "sample/alpha", name: "alpha", backlog: 1234, progress: 12, closed: 98, private: true },
      { id: 2, fullName: "sample/a-very-long-project-name-that-needs-ellipsis", name: "a-very-long-project-name-that-needs-ellipsis", backlog: 1, progress: 0, closed: 3, websiteUrl: "https://configured.example/" },
      { id: 3, fullName: "sample/quiet", name: "quiet", backlog: 0, progress: 0, closed: 0, websiteUrl: "https://inactive.example/" },
      { id: 4, fullName: "other/alpha", name: "alpha", backlog: 8, progress: 2, closed: 5, external: true, private: false, websiteUrl: "https://external.example/" },
    ].map((row, index) => ({ ...row, changedAt: index === 0 ? new Date().toISOString() : null, unreadAt: index === 0 ? new Date().toISOString() : null }));
    if (many) for (let index = 0; index < 40; index++) rows.push({ id: 20 + index, fullName: `sample/project-${index}`, name: `project-${index}`, backlog: 1, progress: 0, closed: 0, changedAt: null, unreadAt: null });
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
          h("a", { class: "sidebar-footer", href: "#license" }, "Synthetic license footer"),
        ]),
        h("main", { class: "workspace" }, "Synthetic sidebar layout fixture"),
      ]);
    } };
    createApp(component).mount(host);
    (window as any).sidebarLayoutFixture = { setMode: (value: string) => { mode.value = value; } };
  }, { mobile, many });
  if (mobile || await page.viewportSize()!.width > 950) await expect(page.locator(".sidebar-repository-row")).toHaveCount(many ? 44 : 4);
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
            return { repository: row.getAttribute("data-repository"), row: box, link: rect(link), icon: image, leftInset: box.left - sidebar.left, rightInset: sidebar.right - box.right, label: rect(label), counts: rect(counts), countsFit: [...row.querySelectorAll(".status-count-value")].every(value => value.scrollWidth <= value.clientWidth), labelEllipsis: getComputedStyle(label).textOverflow, controls: [...row.querySelectorAll(".repository-actions-trigger")].filter(element => element.getBoundingClientRect().width > 0).map(element => rect(element)), dot: rect(icon.querySelector(".project-icon-color")!) };
          });
          return { workspace: rect(document.querySelector(".workspace-navigation")!), sidebar: rect(document.querySelector(".sidebar")!), overflow: document.documentElement.scrollWidth - innerWidth, sidebarOverflow: document.querySelector(".sidebar")!.scrollWidth - document.querySelector(".sidebar")!.clientWidth, rows };
        });
        expect(geometry.overflow).toBeLessThanOrEqual(0); expect(geometry.sidebarOverflow).toBeLessThanOrEqual(0);
        for (const row of geometry.rows) {
          expect(row.labelEllipsis).toBe("ellipsis");
          if (!before) expect(row.countsFit, row.repository + " counts stay readable").toBe(true);
          expect(Math.abs(row.label.left - row.counts.left)).toBeLessThanOrEqual(1);
          expect(Math.abs(row.label.right - row.row.right + 4)).toBeLessThanOrEqual(1);
          for (const control of row.controls) { expect(control.right).toBeLessThanOrEqual(row.row.right + 1); expect(Math.abs(control.left - row.icon.left)).toBeLessThanOrEqual(1); expect(control.right).toBeLessThanOrEqual(row.icon.right + 1); if (mobile) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44); } }
          if (!before) {
            expect(Math.abs(row.icon.height - row.row.height)).toBeLessThanOrEqual(1); expect(row.icon.width).toBe(row.icon.height);
            expect(Math.abs(row.icon.top - row.row.top)).toBeLessThanOrEqual(1); expect(Math.abs(row.icon.left - row.row.left)).toBeLessThanOrEqual(1);
            expect(row.leftInset).toBeLessThanOrEqual(5); expect(row.rightInset).toBeLessThanOrEqual(5);
            expect(row.row.height).toBeLessThanOrEqual(mobile ? 52 : 44);
          }
        }
        if (geometry.rows.length) {
          expect(Math.abs(geometry.workspace.left - geometry.rows[0]!.row.left)).toBeLessThanOrEqual(1);
          expect(Math.abs(geometry.workspace.width - geometry.rows[0]!.row.width)).toBeLessThanOrEqual(1);
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
  await boardSplit(page).uncheck(); await page.getByRole("button", { name: "Lista", exact: true }).click();
  expect((await width(".issue-row .project-icon")).every(value => value === 16)).toBe(true);
});


test("repository context actions support keyboard, touch, dismissal and viewport bounds without shortening names", async ({ browser }) => {
  const menuGeometry: unknown[] = [];
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    const mobile = viewport.width < 651 || viewport.height < 501;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); await fixture(page, mobile);
    const row = page.locator('.sidebar-repository-row[data-repository="sample/a-very-long-project-name-that-needs-ellipsis"]');
    const trigger = row.locator(".repository-actions-trigger"), menu = row.getByRole("menu");
    const nameWidth = (await row.locator(".repository-label").boundingBox())!.width;
    if (!mobile) { await page.mouse.move(1200, 900); await expect(trigger).toHaveCSS("opacity", "0"); await row.hover(); await expect(trigger).toHaveCSS("opacity", "1"); }
    await trigger.focus(); await page.keyboard.press("ArrowDown");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".repo-github")).toBeFocused();
    const longBox = (await menu.boundingBox())!, triggerBox = (await trigger.boundingBox())!;
    expect(longBox.x).toBeGreaterThanOrEqual(0); expect(longBox.y).toBeGreaterThanOrEqual(0); expect(longBox.x + longBox.width).toBeLessThanOrEqual(viewport.width); expect(longBox.y + longBox.height).toBeLessThanOrEqual(viewport.height);
    menuGeometry.push({ viewport, mobile, menu: longBox, trigger: triggerBox, itemSizes: await menu.getByRole("menuitem").evaluateAll(items => items.map(item => ({ width: item.getBoundingClientRect().width, height: item.getBoundingClientRect().height }))) });
    if (evidence) await page.screenshot({ path: `${evidence}/actions-long-${viewport.width}x${viewport.height}-light.png` });
    await page.keyboard.press("ArrowDown"); await expect(menu.locator(".repo-pages")).toBeFocused();
    await page.keyboard.press("End"); await expect(menu.locator(".repo-board-toggle")).toBeFocused();
    await page.keyboard.press("Home"); await expect(menu.locator(".repo-github")).toBeFocused();
    expect((await row.locator(".repository-label").boundingBox())!.width).toBe(nameWidth);
    await page.keyboard.press("Escape"); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
    await trigger.focus(); await page.keyboard.press("ArrowDown"); await expect(menu).toBeVisible(); await expect(menu.locator(".repo-github")).toBeFocused();
    await page.keyboard.press("Tab"); await expect(menu).toBeHidden();
    await trigger.click(); await expect(menu).toBeVisible();
    await menu.locator(".repo-board-toggle").click(); await expect(menu).toBeHidden(); await expect(trigger).toBeFocused();
    await expect(row).not.toHaveClass(/repository-hidden/);
    await trigger.click(); await expect(menu).toBeVisible();
    await page.locator("main.workspace").click({ position: { x: 5, y: 5 }, force: true }); await expect(menu).toBeHidden();
    // The last row can be scrolled, but the native top-layer popup must never be clipped.
    const last = page.locator(".sidebar-repository-row").last();
    await last.locator(".repository-actions-trigger").click(); const lastMenu = last.getByRole("menu"); await expect(lastMenu).toBeVisible();
    const box = (await lastMenu.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    for (const target of await lastMenu.getByRole("menuitem").all()) { const targetBox = (await target.boundingBox())!; expect(targetBox.height).toBeGreaterThanOrEqual(44); }
    if (evidence) {
      await page.screenshot({ path: `${evidence}/actions-${viewport.width}x${viewport.height}-light.png` });
      await page.evaluate(async () => { const modulePath = "/src/lib/theme.ts"; (await import(modulePath)).setTheme("dark"); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
      await page.screenshot({ path: `${evidence}/actions-${viewport.width}x${viewport.height}-dark.png` });
    }
    await page.keyboard.press("Escape"); await expect(lastMenu).toBeHidden();
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/menu-geometry.json`, JSON.stringify(menuGeometry, null, 2));
});


test("whole sidebar owns scrolling for few and many projects while every project and context action stays reachable", async ({ browser }) => {
  const measurements: unknown[] = [];
  const baseline = process.env.SIDEBAR_SCROLL_BEFORE === "1";
  if (evidence) await mkdir(evidence, { recursive: true });
  for (const viewport of scenarios) for (const many of [false, true]) {
    const mobile = viewport.width < 651 || viewport.height < 501 || viewport.touch === true;
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "sv-SE", reducedMotion: "reduce" });
    const page = await context.newPage(); await fixture(page, mobile, many);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(async theme => { const modulePath = "/src/lib/theme.ts"; (await import(modulePath)).setTheme(theme); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }, theme);
      const sidebar = page.locator(".sidebar"), projects = page.locator(".sidebar-projects");
      await sidebar.evaluate(element => { element.scrollTop = 0; });
      if (viewport.width === 950) { await expect(projects).toBeHidden(); continue; }
      const metrics = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>(".sidebar")!, list = document.querySelector<HTMLElement>(".sidebar-projects")!;
        const workspace = document.querySelector(".workspace-navigation")!.getBoundingClientRect(), project = document.querySelector(".sidebar-repository-row")!.getBoundingClientRect();
        return { outerOverflow: getComputedStyle(sidebar).overflowY, innerOverflow: getComputedStyle(list).overflowY, outerHeight: sidebar.clientHeight, outerContent: sidebar.scrollHeight, innerHeight: list.clientHeight, innerContent: list.scrollHeight, innerScrollable: /auto|scroll/.test(getComputedStyle(list).overflowY) && list.scrollHeight > list.clientHeight, pageOverflow: document.documentElement.scrollWidth - innerWidth, widthDrift: Math.abs(workspace.width - project.width), leftDrift: Math.abs(workspace.left - project.left) };
      });
      if (!baseline) {
        expect(metrics.innerOverflow).toBe("visible"); expect(metrics.innerScrollable).toBe(false);
        expect(metrics.outerOverflow).toBe("auto"); expect(metrics.pageOverflow).toBeLessThanOrEqual(0); expect(metrics.widthDrift).toBeLessThanOrEqual(1); expect(metrics.leftDrift).toBeLessThanOrEqual(1);
      }
      if (evidence && viewport.width !== 844) await page.screenshot({ path: `${evidence}/scroll-${baseline ? "before" : "after"}-${viewport.width}x${viewport.height}-${many ? "many" : "few"}-${theme}-top.png` });
      if (!baseline) {
        const last = page.locator(".sidebar-repository-row").last();
        await last.locator(".sidebar-repository").focus();
        const row = (await last.boundingBox())!, aside = (await sidebar.boundingBox())!;
        expect(row.y).toBeGreaterThanOrEqual(aside.y); expect(row.y + row.height).toBeLessThanOrEqual(aside.y + aside.height);
        expect(await projects.evaluate(element => element.scrollTop)).toBe(0);
        if (many) expect(await sidebar.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await page.keyboard.press("Tab"); await expect(last.locator(".repository-actions-trigger")).toBeFocused();
        await page.keyboard.press("Enter"); const menu = last.getByRole("menu"); await expect(menu).toBeVisible(); await expect(menu.locator(".repo-github")).toBeFocused();
        const menuBox = (await menu.boundingBox())!; expect(menuBox.y).toBeGreaterThanOrEqual(0); expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
        await page.keyboard.press("Escape"); await expect(menu).toBeHidden(); await expect(last.locator(".repository-actions-trigger")).toBeFocused();
        await page.locator(".sidebar-footer").focus(); const footer = (await page.locator(".sidebar-footer").boundingBox())!;
        expect(footer.y + footer.height).toBeLessThanOrEqual(viewport.height);
        if (evidence && many) await page.screenshot({ path: `${evidence}/scroll-after-${viewport.width}x${viewport.height}-many-${theme}-bottom.png` });
      }
      measurements.push({ viewport, many, theme, ...metrics });
    }
    await context.close();
  }
  if (evidence) await writeFile(`${evidence}/scroll-${baseline ? "before" : "after"}-geometry.json`, JSON.stringify(measurements, null, 2));
});


test("concise project hover and accessible website actions work in every group and language", async ({ browser }) => {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(); await fixture(page, mobile);
    for (const language of ["sv", "en"]) {
      await page.evaluate(async language => { const path = "/src/lib/i18n.ts"; (await import(path)).setLanguage(language); }, language);
      for (const [repository, website] of [["sample/a-very-long-project-name-that-needs-ellipsis", "https://configured.example/"], ["sample/quiet", "https://inactive.example/"], ["other/alpha", "https://external.example/"]]) {
        const row = page.locator(`.sidebar-repository-row[data-repository="${repository}"]`);
        const link = row.locator(".sidebar-repository");
        await expect(link).toHaveAttribute("title", repository!);
        await expect(link).toHaveAccessibleName(repository!);
        await expect(link).toHaveAccessibleDescription(language === "sv" ? /Backlog:.*Pågående:.*Stängda senaste 30 dagarna:/ : /Backlog:.*In progress:.*Closed in the last 30 days:/);
        if (repository!.includes("very-long")) await expect(link).toHaveAccessibleDescription(language === "sv" ? /Dold i innehållsvyn/ : /Hidden from the content view/);
        await row.locator(".repository-actions-trigger").focus(); await page.keyboard.press("ArrowDown");
        await expect(row.locator(".repo-github")).toBeFocused(); await page.keyboard.press("ArrowDown");
        const action = row.locator(".repo-pages"), label = (language === "sv" ? "Öppna webbplatsen för " : "Open website for ") + repository;
        await expect(action).toBeFocused(); await expect(action).toHaveAttribute("href", website!); await expect(action).toHaveAccessibleName(label); await expect(action).toHaveAttribute("title", label);
        await page.keyboard.press("Escape");
      }
    }
    await context.close();
  }
});
