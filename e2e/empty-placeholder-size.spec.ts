import { expect, test, type Page } from "@playwright/test";
import { setBoardGrouping } from "./support/board-grouping";

// #439: an empty column's placeholder is exactly as tall as a real issue in the same view.
const repo = { id: 439, name: "empty-size", full_name: "sample/empty-size", description: "Fictional empty placeholder fixture", private: true, html_url: "https://github.com/sample/empty-size", owner: { login: "sample" } };

async function fixture(page: Page) {
  const old = new Date(Date.now() - 86400000 * 3).toISOString();
  // Backlog holds ordinary issues, Closed a single one, In progress nothing.
  const issues = [
    ["Plain backlog issue", "open", []],
    ["Labelled backlog issue", "open", ["bug"]],
    ["Closed issue", "closed", []],
  ].map(([title, state, labels], index) => ({
    id: index + 1, number: index + 1, title, comments: 0, body: "", state, created_at: old, updated_at: old,
    closed_at: state === "closed" ? old : null, html_url: `${repo.html_url}/issues/${index + 1}`, assignees: [],
    labels: (labels as string[]).map(name => ({ name, color: "a2eeef" })),
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "empty-size-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) {
      const state = url.searchParams.get("state");
      return route.fulfill({ json: issues.filter(issue => state === "all" || (issue.state === "closed") === (state === "closed")) });
    }
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-empty-size-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(3);
}

async function heights(page: Page, item: string) {
  const empty = page.locator(".column-empty").first();
  await expect(empty).toContainText("Inget pågående arbete");
  const real = page.locator(item).filter({ hasText: "Labelled backlog issue" }).first();
  return { empty: (await empty.boundingBox())!.height, real: (await real.boundingBox())!.height };
}

const viewports = [
  { name: "wide", width: 1600, height: 1000, mobile: false },
  { name: "narrow", width: 1000, height: 900, mobile: false },
  { name: "portrait phone", width: 390, height: 844, mobile: true },
  { name: "landscape phone", width: 844, height: 390, mobile: true },
  { name: "narrow phone", width: 320, height: 568, mobile: true },
];

for (const viewport of viewports) {
  test(`empty placeholder matches an issue at ${viewport.name}`, async ({ browser }, info) => {
    const context = await browser.newContext({ locale: "sv-SE", viewport, isMobile: viewport.mobile, hasTouch: viewport.mobile });
    const page = await context.newPage();
    await fixture(page);
    const shot = (name: string) => page.screenshot({ path: info.outputPath(`${viewport.name}-${name}.png`), fullPage: true });
    for (const grouping of ["none", "split", "swimlanes"] as const) {
      await setBoardGrouping(page, grouping);
      const cards = await heights(page, ".issue-card");
      await shot(`${grouping}-cards`);
      expect(Math.abs(cards.empty - cards.real), `${grouping} cards ${JSON.stringify(cards)}`).toBeLessThanOrEqual(1);
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
      const rows = await heights(page, ".issue-row");
      await shot(`${grouping}-list`);
      expect(Math.abs(rows.empty - rows.real), `${grouping} list ${JSON.stringify(rows)}`).toBeLessThanOrEqual(1);
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Kort", exact: true }).click();
    }
    await context.close();
  });
}
