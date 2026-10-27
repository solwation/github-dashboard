import { expect, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const names = ["repository-project-one", "repository-project-two", "personal-website-tests", "weekend-project-tools", "design-system-library", "repository-project-six", "repository-project-new", "repository-project-old", "a-very-long-repository-name-keeps-its-tooltip"];
const repos = names.map((name, index) => ({ id: index + 1, name, full_name: `density/${name}`, private: index === 2 ? undefined : index % 2 === 0,
  has_pages: index % 3 === 0, description: "Fictional sidebar density fixture", html_url: `https://github.com/density/${name}`, owner: { login: "density" } }));

for (const scenario of [1366, 1600, 1250, 950, 390].map(width => ({ width, large: false })).concat({ width: 1250, large: true })) {
  const { width, large } = scenario;
  test(`sidebar density and footer at ${width}px${large ? " with large counts" : ""}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: width === 1366 ? 768 : width === 390 ? 844 : 1000 }, locale: "sv-SE", isMobile: width === 390, hasTouch: width === 390 });
    const page = await context.newPage();
    const now = new Date().toISOString();
    await page.route("https://api.github.com/**", async route => {
      const url = new URL(route.request().url());
      const repo = repos.find(repo => url.pathname.includes(`/repos/${repo.full_name}/`));
      const data = url.pathname === "/user" ? { login: "sidebar-density", avatar_url: "" } : url.pathname === "/user/repos" ? repos
        : repo && url.pathname.endsWith("/issues") && url.searchParams.get("state") !== "closed" ? Array.from({ length: large && repo.id === 1 ? 1000 : 1 }, (_, index) => ({ id: repo.id * 10000 + index, number: index + 1, title: `Task for ${repo.name}`, body: "Fixture", comments: 0,
          labels: [], assignees: [], state: "open", created_at: now, updated_at: now, html_url: `${repo.html_url}/issues/${index + 1}` })) : [];
      await route.fulfill({ json: data });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
    await page.getByLabel("GitHub personal access token").fill("fictional-sidebar-density-token");
    await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
    for (const repo of repos) await page.getByRole("checkbox", { name: new RegExp(repo.full_name) }).check();
    await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
    await expect(page.locator(".sidebar-repository-row")).toHaveCount(9);
    await expect(page.locator(".sidebar-repository .status-count")).toHaveCount(27);
    if (large) {
      await expect(page.locator(".has-wide-counts")).toHaveCount(1);
      const measured = await page.locator(".sidebar-repository").evaluateAll(rows => rows.map(row => {
        const counts = row.querySelector(".repository-counts")!.getBoundingClientRect();
        const slots = row.querySelector(".repo-slots")!.getBoundingClientRect();
        const values = [...row.querySelectorAll<HTMLElement>(".status-count-value")];
        return { separate: counts.bottom <= slots.top + 1, full: values.every(value => value.scrollWidth <= value.clientWidth + 1),
          lefts: [...row.querySelectorAll(".status-count")].map(value => value.getBoundingClientRect().left) };
      }));
      for (const row of measured) {
        expect(row.separate).toBe(true); expect(row.full).toBe(true);
        row.lefts.forEach((left, index) => expect(Math.abs(left - measured[0]!.lefts[index]!)).toBeLessThanOrEqual(1));
      }
    }
    const results = [];
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      if (width === 390) await page.getByRole("button", { name: "Meny", exact: true }).click();
      const metrics = await page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar")!;
        const panel = document.querySelector(".sidebar-projects")!.getBoundingClientRect();
        const rows = [...document.querySelectorAll<HTMLElement>(".sidebar-repository-row")].map(row => {
          const box = row.getBoundingClientRect(), label = row.querySelector<HTMLElement>(".repository-label")!;
          return { name: label.textContent, height: box.height, width: label.clientWidth, clipped: label.scrollWidth > label.clientWidth,
            visible: box.top >= panel.top && box.bottom <= panel.bottom, left: label.getBoundingClientRect().left };
        });
        return { sidebarWidth: sidebar.getBoundingClientRect().width, visible: rows.filter(row => row.visible).length,
          footerHeight: document.querySelector(".sidebar-version")!.getBoundingClientRect().height + document.querySelector(".sidebar-footer")!.getBoundingClientRect().height,
          rows, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      results.push({ theme, ...metrics });
      expect(metrics.overflow).toBe(false);
      if (!process.env.SIDEBAR_BASELINE) {
        if (width > 950) {
          await expect(page.locator(".sidebar-version")).toBeVisible();
          await expect(page.locator(".sidebar-footer")).toBeVisible();
          expect(metrics.footerHeight).toBeLessThanOrEqual(80);
          if (width === 1366) {
            expect(metrics.sidebarWidth).toBe(226);
            expect(metrics.rows.find(row => row.name === names[0])!.clipped).toBe(false);
            expect(metrics.rows.find(row => row.name === names[1])!.clipped).toBe(false);
            if (process.env.EVIDENCE_DIR && existsSync(`${process.env.EVIDENCE_DIR}/baseline-1366.json`)) {
              const baseline = JSON.parse(readFileSync(`${process.env.EVIDENCE_DIR}/baseline-1366.json`, "utf8"));
              expect(metrics.visible).toBeGreaterThan(baseline[0].visible);
            }
          }
          expect(Math.max(...metrics.rows.map(row => row.left)) - Math.min(...metrics.rows.map(row => row.left))).toBeLessThanOrEqual(1);
        } else {
          await expect(page.locator(".sidebar-projects")).toBeHidden();
          if (width === 390) await expect(page.locator("#mobile-tools-menu")).toBeVisible();
        }
      }
      if (process.env.EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/${process.env.SIDEBAR_BASELINE ? "baseline" : "sidebar"}-${width}-${theme}.png` });
      if (width === 390) await page.getByRole("button", { name: "Meny", exact: true }).click();
    }
    if (process.env.EVIDENCE_DIR) writeFileSync(`${process.env.EVIDENCE_DIR}/${process.env.SIDEBAR_BASELINE ? "baseline" : "geometry"}-${width}.json`, JSON.stringify(results, null, 2));
    await context.close();
  });
}
