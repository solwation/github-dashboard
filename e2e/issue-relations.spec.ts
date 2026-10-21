import { expect, test, type Page } from "@playwright/test";
const repo = { id: 66, name: "relations", full_name: "sample/relations", private: true, description: "Fictional relations", html_url: "https://github.com/sample/relations", owner: { login: "sample" } };
const stamp = "2026-10-15T12:00:00Z";
function issue(number: number, title: string) {
  return { id: number, number, title, state: "open", created_at: stamp, updated_at: stamp, closed_at: null, labels: [], assignees: [], comments: 0, html_url: `${repo.html_url}/issues/${number}` };
}
async function connect(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-sub-issues-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: /sample\/relations/ }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
}

test("native sub-issue progress and parent links survive filters, update on sync and fit mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  let completed = 2, removed = false;
  const parent = { number: 1, title: "Roadmap parent", url: `${repo.html_url}/issues/1` };
  const cross = { number: 42, title: "Cross repository plan with a long description ".repeat(5), url: "https://github.com/another/planning/issues/42" };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "relations-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : [
      { ...issue(1, parent.title), sub_issues_summary: { total: 5, completed } },
      issue(2, "Implementation child"), issue(3, "Nested work"), issue(4, "Plain task"), issue(5, "Hidden access"),
    ] });
    if (url.pathname === "/graphql") {
      const { query, variables } = route.request().postDataJSON();
      expect(query).toContain("query IssueRelations");
      if (variables.number === 5) return route.fulfill({ status: 403, json: { message: "Resource not accessible by personal access token" } });
      return route.fulfill({ json: { data: { repository: { issue: {
        parent: variables.number === 2 && !removed ? parent : variables.number === 3 ? cross : null,
        subIssuesSummary: variables.number === 1 ? { total: 5, completed } : variables.number === 3 ? { total: 2, completed: 0 } : { total: 0, completed: 0 },
      } } } } });
    }
    return route.fulfill({ json: [] });
  });
  await connect(page);
  const card = (title: string) => page.locator(".issue-card").filter({ has: page.getByRole("link", { name: title, exact: true }) });
  const roadmap = card(parent.title);
  await roadmap.scrollIntoViewIfNeeded();
  await expect(roadmap.locator("progress")).toHaveCount(0);
  await roadmap.getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(roadmap.getByRole("progressbar", { name: "2 av 5 underärenden stängda" })).toHaveAttribute("value", "2");
  await expect(roadmap.locator("progress")).toHaveAttribute("max", "5");
  await expect(roadmap.locator(".sub-issue-progress-label")).toContainText("40%");
  await expect(roadmap.locator(".parent-task-badge")).toContainText("2/5 klara");
  const child = card("Implementation child");
  await child.scrollIntoViewIfNeeded();
  await expect(child.locator(".subtask-badge")).toContainText("Subtask");
  await expect(child.locator(".issue-parent button")).toHaveText("#1 · Roadmap parent");
  const nested = card("Nested work");
  await nested.scrollIntoViewIfNeeded();
  await expect(nested.locator(".issue-parent button")).toContainText("another/planning#42");
  await nested.getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(nested.getByRole("progressbar", { name: "0 av 2 underärenden stängda" })).toHaveAttribute("value", "0");
  await nested.locator(".issue-parent button").focus();
  await expect(nested.locator(".issue-parent button")).toBeFocused();
  for (const title of ["Plain task", "Hidden access"]) {
    await card(title).scrollIntoViewIfNeeded();
    await expect(card(title).locator(".issue-relations")).toHaveCount(0);
  }
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("Roadmap");
  await expect(page.locator(".issue-card")).toHaveCount(1);
  await expect(roadmap.locator(".sub-issue-progress-label")).toContainText("2 av 5");
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
  completed = 4; removed = true;
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  await page.keyboard.press("F5");
  await expect(roadmap.locator(".sub-issue-progress-label")).toContainText("4 av 5");
  await child.scrollIntoViewIfNeeded();
  await expect(child.locator(".issue-parent")).toHaveCount(0);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await nested.scrollIntoViewIfNeeded();
  await expect(nested.locator(".issue-parent > span")).toHaveText("Parent issue");
  await nested.getByRole("button", { name: "Read more", exact: true }).click();
  await expect(nested.getByRole("progressbar", { name: "0 of 2 sub-issues closed" })).toBeVisible();
  // Phone rows expose only a compact relation marker; full hierarchy remains in details, while desktop keeps descriptive badges.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".board-toolbar").getByRole("button", { name: "List", exact: true }).click();
  const parentRow = page.locator(".issue-row").filter({ hasText: parent.title });
  await expect(parentRow.locator(".row-parent-badge")).toContainText("4/5");
  const nestedRow = page.locator(".issue-row").filter({ hasText: "Nested work" });
  await expect(nestedRow.locator(".row-subtask-badge")).toContainText("Subtask");
  await expect(nestedRow.locator(".row-parent-badge")).toContainText("0/2");
  await page.locator(".board-toolbar").getByRole("button", { name: "Cards", exact: true }).click();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("REST progress stays available when GraphQL is denied and late parent responses cannot cross sessions", async ({ page }) => {
  let deny = true, requests = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "private-relations", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: [repo] });
    if (url.pathname.endsWith("/issues")) return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : [{ ...issue(1, "REST parent fixture"), sub_issues_summary: { total: 3, completed: 0 } }] });
    if (url.pathname.endsWith("/sub_issues")) return route.fulfill({ status: 403, json: { message: "Resource not accessible" } });
    if (url.pathname === "/graphql") {
      requests++;
      if (deny) return route.fulfill({ status: 403, json: { message: "Resource not accessible by personal access token" } });
      await pending;
      return route.fulfill({ json: { data: { repository: { issue: { parent: { number: 99, title: "Former account private parent", url: `${repo.html_url}/issues/99` }, subIssuesSummary: { total: 3, completed: 1 } } } } } });
    }
    return route.fulfill({ json: [] });
  });
  await connect(page);
  await page.locator(".issue-card").getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "0 av 3 underärenden stängda" })).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator(".issue-sub-issues progress")).toHaveCount(1);
  await expect(page.locator(".issue-sub-issues li")).toHaveCount(0);
  await expect(page.locator(".sub-issues-loading")).toHaveCount(0);
  await expect(page.locator(".issue-parent")).toHaveCount(0);
  await expect(page.locator(".issue-card")).not.toContainText(/permission|åtkomst|kunde inte/);
  deny = false;
  await page.keyboard.press("F5");
  await expect.poll(() => requests).toBe(2);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  release();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
  await expect(page.locator("body")).not.toContainText("Former account private parent");
  await expect(page.locator(".issue-parent")).toHaveCount(0);
});
