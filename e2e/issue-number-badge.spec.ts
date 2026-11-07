import { expect, test, type Page, type BrowserContext, type TestInfo } from "@playwright/test";
import { boardSplit } from "./support/board-grouping";

const repos = [
  { id: 901, name: "lunden-3d-apartment-with-a-very-long-repository-name", full_name: "sample/lunden-3d-apartment-with-a-very-long-repository-name", description: "Fictional layout fixture", private: false, html_url: "https://github.com/sample/lunden-3d-apartment-with-a-very-long-repository-name", owner: { login: "sample" } },
  { id: 902, name: "github-dashboard", full_name: "sample/github-dashboard", description: "Fictional layout fixture", private: false, html_url: "https://github.com/sample/github-dashboard", owner: { login: "sample" } },
];
const longTitle = "Bion i lekstugan: vinjett i stället för klicktext på duken, 7.1-högtalare och dimmade lampetter under film";
const created = new Date(Date.now() - 86_400_000).toISOString();
const issues = repos.flatMap((repo, repoIndex) => [
  { id: repoIndex * 3 + 1, number: repoIndex * 100000 + 12345, title: repoIndex === 0 ? longTitle : `${repo.name}: another backlog item`, state: "open", labels: [{ name: "enhancement", color: "a2eeef" }, { name: "a-very-long-workflow-label-that-must-stay-on-one-line", color: "cfd3d7" }] },
  { id: repoIndex * 3 + 2, number: repoIndex * 100000 + 23456, title: `${repo.name} pågående`, state: "open", labels: [{ name: "in-progress", color: "fbca04" }] },
  { id: repoIndex * 3 + 3, number: repoIndex * 100000 + 3, title: `${repo.name} avslutat`, state: "closed", labels: [{ name: "bug", color: "d73a4a" }] },
].map(issue => ({
  ...issue,
  body: "Fictional public layout fixture; contains no real issue content.",
  comments: 0,
  created_at: created,
  updated_at: created,
  closed_at: issue.state === "closed" ? created : null,
  html_url: `${repo.html_url}/issues/${issue.number}`,
  assignees: [],
})));

async function mockApi(page: Page) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "badge-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repos;
    else if (url.pathname === "/graphql") data = { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } };
    else if (url.pathname.endsWith("/events")) data = [];
    else if (url.pathname.endsWith("/issues")) {
      const pathRepo = repos.find(repo => url.pathname.startsWith(`/repos/${repo.full_name}/`));
      const state = url.searchParams.get("state");
      data = pathRepo ? issues.filter(issue => issue.html_url.startsWith(pathRepo.html_url + "/issues/") && (state === "all" || (state === "closed") === (issue.state === "closed"))) : [];
    }
    await route.fulfill({ json: data });
  });
}

async function connect(page: Page, baseUrl: string) {
  await page.goto(baseUrl);
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-badge-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(6);
}


const rgb = (value: string) => value.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
const lum = ([r, g, b]: number[]) => { const c = [r!, g!, b!].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
const scenarios = [
  { name: "wide", width: 1600, height: 1000, mobile: false },
  { name: "narrow", width: 1000, height: 900, mobile: false },
  { name: "portrait", width: 390, height: 844, mobile: true },
  { name: "landscape", width: 844, height: 390, mobile: true },
  { name: "tiny", width: 320, height: 568, mobile: true },
];

test("issue numbers are repository-colored badges in cards and lists, light and dark", async ({ page }) => {
  test.setTimeout(240_000);
  await mockApi(page);
  await connect(page, "/");
  for (const split of [false, true]) {
    await (split ? boardSplit(page).check() : boardSplit(page).uncheck());
    for (const mode of [{ name: "Kort", link: ".issue-card .card-issue-link", item: ".issue-card" }, { name: "Lista", link: ".issue-row .row-number", item: ".issue-row" }]) {
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: mode.name, exact: true }).click();
      for (const scheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        for (const scenario of scenarios) {
          await page.setViewportSize({ width: scenario.width, height: scenario.height });
          await expect(page.locator(mode.item)).toHaveCount(6);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${scenario.name} overflow`).toBe(true);
          const links = page.locator(mode.link);
          for (let i = 0; i < 6; i++) {
            const link = links.nth(i);
            const style = await link.evaluate(node => {
              const s = getComputedStyle(node);
              return { bg: s.backgroundColor, fg: s.color, repo: getComputedStyle(node.closest("[data-repository], .issue-card")!).getPropertyValue("--repository-color").trim() };
            });
            expect(ratio(style.bg, style.fg), `${scenario.name} ${scheme} contrast`).toBeGreaterThanOrEqual(4.5);
            const box = (await link.boundingBox())!;
            const parentBox = (await link.evaluate(node => { const r = (node.closest(".card-top-main, .row-id") ?? node.parentElement!).getBoundingClientRect(); return { x: r.x, right: r.right }; }));
            expect(box.x + box.width, `${scenario.name} badge clipped`).toBeLessThanOrEqual(parentBox.right + 1);
            if (mode.name === "Lista") {
              const titleX = await link.evaluate(node => node.closest(".issue-row")!.querySelector(".row-title")!.getBoundingClientRect().x);
              expect(box.x + box.width, `${scenario.name} badge overlaps title`).toBeLessThanOrEqual(titleX + 0.5);
              // #435: above 480px the list badge is a square spanning both row lines; portrait phones keep the one-line badge.
              const square = await link.evaluate(node => { const r = node.closest(".row-id")!.getBoundingClientRect(); return { w: r.width, h: r.height }; });
              if (scenario.width > 480) {
                expect(Math.abs(square.w - square.h), `${scenario.name} list badge is square`).toBeLessThanOrEqual(1);
                expect(square.h, `${scenario.name} list badge spans two lines`).toBeGreaterThanOrEqual(34);
              }
            }
            expect(await link.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
          }
          const boxes = await links.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, h: r.height }; }));
          expect(Math.max(...boxes.map(b => b.h)) - Math.min(...boxes.map(b => b.h)), `${scenario.name} badge heights`).toBeLessThanOrEqual(1);
          if (mode.name === "Lista") expect(Math.max(...boxes.map(b => b.x)) - Math.min(...boxes.map(b => b.x)), `${scenario.name} badge x`).toBeLessThanOrEqual(1);
          if (!split && scheme === "light") console.log("MEASURE", mode.name, scenario.name, "badge h", boxes[0]!.h.toFixed(1), "x-spread", (Math.max(...boxes.map(b => b.x)) - Math.min(...boxes.map(b => b.x))).toFixed(1));
          const first = links.first();
          await expect(first).toHaveAttribute("aria-label", /^Öppna #\d+ på GitHub$/);
          await expect(first).toHaveAttribute("href", /github\.com\/sample\/.*\/issues\/\d+/);
          await page.locator(mode.item).first().scrollIntoViewIfNeeded();
          if (!split && ["wide", "portrait", "tiny", "landscape", "narrow"].includes(scenario.name)) {
            await page.screenshot({ path: `docs/verification/420/${mode.name === "Kort" ? "cards" : "list"}-${scenario.name}-${scheme}.png`, fullPage: false });
          }
        }
      }
    }
  }
});

test("badge keeps a visible keyboard focus ring and the link role", async ({ page }) => {
  await mockApi(page);
  await connect(page, "/");
  await page.setViewportSize({ width: 1600, height: 1000 });
  const link = page.locator(".issue-card .card-issue-link").first();
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const outline = await link.evaluate(node => getComputedStyle(node).outlineStyle + getComputedStyle(node).outlineWidth);
  expect(outline).toBe("solid2px");
  await link.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "docs/verification/420/cards-focus.png" });
});
