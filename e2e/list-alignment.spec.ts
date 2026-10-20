import { expect, test, type Page } from "@playwright/test";

const repo = { id: 190, name: "list-align", full_name: "sample/list-align", description: "Fictional list alignment fixture", private: true, html_url: "https://github.com/sample/list-align", owner: { login: "sample" } };

async function fixture(page: Page) {
  const now = Date.now(), old = new Date(now - 86400000 * 3).toISOString(), recent = new Date(now - 3600000).toISOString();
  // [title, comments, section label, state, extra labels]
  const specs: [string, number, string | null, "open" | "closed", string[]][] = [
    ["Backlog one", 1, null, "open", ["bug"]],
    ["Backlog twelve", 12, null, "open", ["enhancement", "bug"]],
    ["Backlog many", 123, null, "open", ["bug"]],
    ["Backlog none", 0, null, "open", []],
    ["Progress one", 1, "in progress", "open", ["bug"]],
    ["Progress many", 123, "in progress", "open", ["enhancement"]],
    ["Closed twelve", 12, null, "closed", ["bug"]],
    ["Closed none", 0, null, "closed", ["enhancement"]],
    ["Closed third", 0, null, "closed", []],
  ];
  const issues = specs.map(([title, comments, status, state, labels], index) => ({
    id: index + 1, number: index + 1, title, comments, body: "", state, created_at: old, updated_at: recent, closed_at: state === "closed" ? recent : null,
    html_url: `${repo.html_url}/issues/${index + 1}`, assignees: [],
    startedAt: state === "closed" ? new Date(now - 3600000 - 30 * 60000).toISOString() : undefined,
    labels: [...(status ? [{ name: status, color: "fbca04" }] : []), ...[...labels, "ui"].map(name => ({ name, color: "a2eeef" }))],
  }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "list-align-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) {
      const closed = url.searchParams.get("state") === "closed";
      return route.fulfill({ json: issues.filter(issue => (issue.state === "closed") === closed || url.searchParams.get("state") === "all") });
    }
    if (url.pathname.endsWith("/issues/5/events")) return route.fulfill({ json: [{ id: 1, event: "labeled", label: { name: "in progress" }, created_at: new Date(now - 10 * 60000).toISOString() }] });
    if (url.pathname === "/graphql") return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-list-align-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator(".issue-row")).toHaveCount(specs.length);
}

// Left edge of a column cell relative to its row, rounded to sub-pixel noise.
const left = async (row: ReturnType<Page["locator"]>, selector: string) => {
  const [cell, box] = await Promise.all([row.locator(selector).first().boundingBox(), row.boundingBox()]);
  return Math.round((cell!.x - box!.x) * 10) / 10;
};

for (const theme of ["light", "dark"]) {
  test(`list columns share left edges across rows, comment counts and sections (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
    await fixture(page);
    const rows = page.locator(".issue-row");
    await expect(page.locator(".issue-row.backlog")).toHaveCount(4);
    await expect(page.locator(".issue-row.progress")).toHaveCount(2);
    await expect(page.locator(".issue-row.closed")).toHaveCount(3);
    await expect(page.locator(".issue-row .issue-time-remaining")).toHaveCount(1);
    const columns: Record<string, string> = {
      number: ".row-number", title: ".row-title", meta: ".row-meta", commentSlot: ".row-slot-comment", status: ".row-status",
      priority: ".row-slot-priority", label: ".row-meta .label", commentIcon: ".row-comments .comment-count svg",
      commentCount: ".row-comments .comment-count-value", time: ".row-time",
    };
    for (const [name, selector] of Object.entries(columns)) {
      const edges = new Set<number>();
      for (let index = 0; index < await rows.count(); index++) {
        const row = rows.nth(index);
        if (name === "priority" && (await row.getAttribute("class"))!.includes("closed")) continue;
        edges.add(await left(row, selector));
      }
      expect(edges.size, `${name} left edges ${[...edges]}`).toBe(1);
    }
    // The new-comment marker icon also starts at one x position regardless of digit count.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Absolute x of the comment icon is identical in every section, not only relative to the row.
    const xs = await rows.evaluateAll(list => [...new Set(list.map(row => Math.round(row.querySelector(".row-comments .comment-count svg")!.getBoundingClientRect().x)))]);
    expect(xs).toHaveLength(1);
  });
}

test("compact layout keeps badges flowing without reserved slots", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await fixture(page);
  const slot = page.locator(".issue-row").first().locator(".row-slot-status");
  expect(await slot.evaluate(node => getComputedStyle(node).display)).toBe("contents");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
