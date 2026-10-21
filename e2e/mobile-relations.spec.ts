import { expect, test, type Browser } from "@playwright/test";

const repositories = [
  { id: 81, name: "relations", full_name: "sample/relations", private: true, description: "Fictional relations", html_url: "https://github.com/sample/relations", owner: { login: "sample" } },
  { id: 82, name: "a-very-long-repository-name", full_name: "another/a-very-long-repository-name", private: true, description: "Fictional child repository", html_url: "https://github.com/another/a-very-long-repository-name", owner: { login: "another" } },
];
const stamp = "2026-10-15T12:00:00Z";
function issue(number: number, title: string, repository = repositories[0]!) {
  return { id: number, number, title, state: "open", created_at: stamp, updated_at: stamp, closed_at: null, labels: [], assignees: [], comments: 0, html_url: `${repository.html_url}/issues/${number}` };
}
const viewports = [
  { name: "wide desktop", width: 1600, height: 1000, mobile: false },
  { name: "narrow desktop", width: 1000, height: 900, mobile: false },
  { name: "portrait touch", width: 390, height: 844, mobile: true },
  { name: "landscape touch", width: 844, height: 390, mobile: true },
  { name: "narrow touch", width: 320, height: 568, mobile: true },
];

async function connect(browser: Browser, baseURL: string | undefined, device: typeof viewports[number]) {
  const context = await browser.newContext({ baseURL, viewport: { width: device.width, height: device.height }, isMobile: device.mobile, hasTouch: device.mobile, locale: "sv-SE" });
  const page = await context.newPage();
  let relationRequests = 0;
  const longChild = issue(3, "Long child title and a long repository label", repositories[1]!);
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repo = repositories.find(item => url.pathname.startsWith(`/repos/${item.full_name}/`));
    if (url.pathname === "/user") return route.fulfill({ json: { login: "mobile-relations-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repositories });
    if (url.pathname.endsWith("/issues")) {
      const items = repo?.id === 82
        ? [longChild]
        : [
          { ...issue(1, "Parent with zero complete"), sub_issues_summary: { total: 5, completed: 0 } },
          issue(2, "Parent with all complete"), issue(4, "Standalone task"), issue(5, "Relation unavailable"),
        ];
      return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : items });
    }
    if (url.pathname === "/graphql") {
      relationRequests++;
      const { variables } = route.request().postDataJSON();
      if (variables.number === 5) return route.fulfill({ status: 403, json: { message: "Resource not accessible" } });
      const relations = variables.number === 1 ? { parent: null, subIssuesSummary: { total: 5, completed: 0 } }
        : variables.number === 2 ? { parent: null, subIssuesSummary: { total: 4, completed: 4 } }
          : variables.number === 3 ? { parent: { number: 42, title: "Parent lives in a different repository", url: "https://github.com/sample/relations/issues/42" }, subIssuesSummary: { total: 0, completed: 0 } }
            : { parent: null, subIssuesSummary: { total: 0, completed: 0 } };
      return route.fulfill({ json: { data: { repository: { issue: relations } } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-mobile-relations-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repository of repositories) await page.getByRole("checkbox", { name: repository.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".repository-loading")).toHaveCount(0);
  return { context, page, relationRequests: () => relationRequests };
}

for (const device of viewports) test(`mobile relation indicators stay compact and accessible (${device.name})`, async ({ browser }, info) => {
  const { context, page, relationRequests } = await connect(browser, info.project.use.baseURL, device);
  try {
    for (const combined of [false, true]) {
      if (combined) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
      else if (await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).count()) await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).check();
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
      const rows = page.locator(".issue-row");
      await expect(rows).toHaveCount(5);
      for (let index = 0; index < await rows.count(); index++) {
        await rows.nth(index).scrollIntoViewIfNeeded();
        await expect(rows.nth(index).locator(".row-title")).toBeVisible();
      }
      const row = (title: string) => rows.filter({ has: page.locator(".row-title-text", { hasText: title }) });
      const zero = row("Parent with zero complete");
      const parentSelector = device.mobile ? ".row-mobile-relation" : ".row-parent-badge";
      const childSelector = device.mobile ? ".row-mobile-relation" : ".row-subtask-badge";
      await expect(zero.locator(parentSelector)).toContainText("0/5");
      await expect(zero.locator(parentSelector)).toHaveAttribute("aria-label", "0 av 5 underärenden stängda");
      await expect(row("Parent with all complete").locator(parentSelector)).toContainText("4/4");
      const child = row("Long child title").locator(childSelector);
      if (device.mobile) await expect(child).toHaveAttribute("aria-label", /Underärende till sample\/relations#42/);
      await expect(child).toHaveAttribute("title", /Parent lives in a different repository/);
      await expect(row("Standalone task").locator(parentSelector + "," + childSelector)).toHaveCount(0);
      await expect(row("Relation unavailable").locator(parentSelector + "," + childSelector)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const current of [zero, row("Long child title")]) {
        const relation = current.locator(device.mobile ? ".row-mobile-relation" : ".row-parent-badge, .row-subtask-badge").first();
        const time = current.locator(".row-time");
        if (await relation.isVisible() && await time.isVisible()) {
          const [a, b] = await Promise.all([relation.boundingBox(), time.boundingBox()]);
          expect(a && b && (a.x + a.width <= b.x || b.x + b.width <= a.x)).toBe(true);
        }
      }
      if (device.width <= 390) await page.screenshot({ path: info.outputPath(`${device.width}-${combined ? "combined" : "split"}-list.png`), fullPage: true });
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Kort", exact: true }).click();
      const childCard = page.locator(".issue-card").filter({ has: page.getByRole("link", { name: "Long child title and a long repository label", exact: true }) });
      await childCard.scrollIntoViewIfNeeded();
      await expect(childCard.locator(".subtask-badge")).toHaveCount(1);
      if (device.width <= 390) await page.screenshot({ path: info.outputPath(`${device.width}-${combined ? "combined" : "split"}-cards.png`), fullPage: true });
    }
    expect(relationRequests()).toBe(5);
  } finally {
    await context.close();
  }
});
