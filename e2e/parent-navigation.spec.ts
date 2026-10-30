import { expect, test, type Page } from "@playwright/test";
import { devOrigin } from "./ports";

const repos = [
  { id: 401, name: "child", full_name: "sample/child", private: true, description: "", html_url: "https://github.com/sample/child", owner: { login: "sample" } },
  { id: 402, name: "parent", full_name: "sample/parent", private: true, description: "", html_url: "https://github.com/sample/parent", owner: { login: "sample" } },
];
const stamp = new Date(Date.now() - 86400000).toISOString();
function issue(repo: typeof repos[number], number: number, title: string, labels: string[] = []) {
  return { id: repo.id * 100 + number, number, title, state: "open", created_at: stamp, updated_at: stamp, closed_at: null,
    labels: labels.map(name => ({ name, color: "336699" })), assignees: [], comments: 0, html_url: `${repo.html_url}/issues/${number}` };
}

async function fixture(page: Page) {
  let popups = 0;
  page.on("popup", () => { popups++; });
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "parent-navigation-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues")) {
      const owner = url.pathname.split("/")[2], name = url.pathname.split("/")[3];
      const repo = repos.find(item => item.owner.login === owner && item.name === name)!;
      if (url.searchParams.get("state") === "closed") return route.fulfill({ json: [] });
      if (repo === repos[0]) return route.fulfill({ json: [issue(repo, 2, "Child task", ["in-progress"])] });
      return route.fulfill({ json: [{ ...issue(repo, 42, "Parent target", ["in-progress"]), sub_issues_summary: { total: 1, completed: 0 } }, issue(repo, 43, "Child target", ["in-progress"])] });
    }
    if (url.pathname === "/repos/sample/parent/issues/42/sub_issues") return route.fulfill({ json: [issue(repos[1]!, 43, "Child target", ["in-progress"])] });
    if (url.pathname === "/graphql") {
      const { variables } = route.request().postDataJSON();
      return route.fulfill({ json: { data: { repository: { issue: {
        parent: variables.number === 2 ? { number: 42, title: "Parent target", url: "https://github.com/sample/parent/issues/42" } : null,
        subIssuesSummary: variables.number === 42 ? { total: 1, completed: 0 } : null,
      } } } } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-parent-navigation-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: /sample\/child/ }).check();
  await page.getByRole("checkbox", { name: /sample\/parent/ }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card").filter({ hasText: "Child task" })).toBeVisible();
  return { popupCount: () => popups };
}

for (const mode of ["Cards", "List"] as const) {
  test(`parent selection navigates to the right cross-repository status in split and combined ${mode.toLowerCase()} boards`, async ({ page }, info) => {
    const popup = await fixture(page);
    const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }]) {
      await page.setViewportSize(viewport);
      for (const combined of [false, true]) {
      if (combined) await split.uncheck(); else await split.check();
      await page.locator(".board-mode-toggle").locator(`[title="${mode === "List" ? "Lista" : "Kort"}"]`).click();
      const child = page.locator(".issue-card, .issue-row").filter({ hasText: "Child task" }).first();
      if (mode === "List") await child.locator(".row-title").click();
      else await child.getByRole("button", { name: "Läs mer", exact: true }).click();
      const parentButton = child.locator(".issue-parent button");
      await expect(parentButton).toContainText("Parent target");
      // A search must not strand the destination; parent selection clears it as needed.
      await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("Child task");
      const popupCountBeforeParentSelection = popup.popupCount();
      await parentButton.click();
      const target = page.locator('[id="issue-sample%2Fparent-42"]');
      await expect(target).toBeVisible();
      await expect(target).toHaveClass(/issue-navigation-highlight/);
      await expect(target).toBeFocused();
      await expect(target.locator(".issue-title, .row-title").first()).toContainText("Parent target");
      const githubLink = mode === "List" ? target.locator("a.issue-number") : target.locator("a.issue-title");
      await expect(githubLink).toHaveAttribute("href", "https://github.com/sample/parent/issues/42");
      await expect(page.getByRole("textbox", { name: "Sök issues", exact: true })).toHaveValue("");
      if (combined) await expect(target.locator(".row-repository, .card-repository")).toHaveAttribute("title", "sample/parent");
      else await expect(page.locator(".repo-lane").filter({ has: target }).locator(".lane-title h2 a")).toHaveAttribute("title", "sample/parent");
      await target.screenshot({ path: info.outputPath(`${viewport.width}-${mode.toLowerCase()}-${combined ? "combined" : "split"}-parent-highlight.png`) });
      expect(popup.popupCount()).toBe(popupCountBeforeParentSelection);
      await expect(githubLink).toHaveAttribute("target", "_blank");
      if (mode === "List") await target.locator(".row-title").click();
      else await target.getByRole("button", { name: "Läs mer", exact: true }).click();
      await expect(githubLink).toBeVisible();
      if (combined) await split.check();
      }
      // The separate GitHub title/number link remains an external action.
      const target = page.locator('[id="issue-sample%2Fparent-42"]');
      const popupPromise = page.waitForEvent("popup");
      const githubLink = mode === "List" ? target.locator("a.issue-number") : target.locator("a.issue-title");
      await githubLink.click();
      const external = await popupPromise;
      await expect(external).toHaveURL("https://github.com/sample/parent/issues/42");
      await external.close();
    }
  });
}

test("parent navigation works on touch phones in portrait, landscape and 320px layouts", async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: devOrigin, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, locale: "sv-SE" });
  try {
    const page = await context.newPage();
    await fixture(page);
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(size);
      for (const mode of ["Cards", "List"] as const) {
        const combined = mode === "List";
        const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
        if (combined) await split.uncheck(); else await split.check();
        await page.locator(".board-mode-toggle").locator(`[title="${mode === "List" ? "Lista" : "Kort"}"]`).click();
        const child = page.locator(".issue-card, .issue-row").filter({ hasText: "Child task" }).first();
        if (mode === "List") await child.locator(".row-title").click();
        else await child.getByRole("button", { name: "Läs mer", exact: true }).click();
        const parentButton = mode === "List"
          ? page.getByRole("dialog", { name: "Child task" }).locator(".issue-parent button")
          : child.locator(".issue-parent button");
        await expect(parentButton).toBeVisible();
        await parentButton.click();
        const target = page.locator('[id="issue-sample%2Fparent-42"]');
        await expect(target).toBeVisible();
        await expect(target).toHaveClass(/issue-navigation-highlight/);
        await expect(target).toBeFocused();
        if (mode === "List") await expect(child.locator(".row-title")).toHaveAttribute("aria-expanded", "false");
        await target.screenshot({ path: info.outputPath(`${size.width}x${size.height}-${mode.toLowerCase()}-${combined ? "combined" : "split"}.png`) });
      }
    }
  } finally { await context.close(); }
});

test("child selection from a parent navigates and highlights the board issue without opening GitHub", async ({ page }, info) => {
  const popup = await fixture(page);
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1000, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ["Cards", "List"] as const) {
      for (const combined of [false, true]) {
      const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
      if (combined) await split.uncheck(); else await split.check();
      await page.locator(".board-mode-toggle").locator(`[title="${mode === "List" ? "Lista" : "Kort"}"]`).click();
      const parent = page.locator('[id="issue-sample%2Fparent-42"]');
      if (mode === "List") await parent.locator(".row-title").click();
      else await parent.getByRole("button", { name: "Läs mer", exact: true }).click();
      const details = parent;
      if (mode === "Cards") await expect(parent.locator(".details-toggle")).toHaveAttribute("aria-expanded", "true");
      const childLink = details.locator(".issue-sub-issues button");
      await expect(childLink).toContainText("Child target");
      const popupsBefore = popup.popupCount();
      await childLink.click();
      const target = page.locator('[id="issue-sample%2Fparent-43"]');
      await expect(target).toBeVisible();
      await expect(target).toHaveClass(/issue-navigation-highlight/);
      await expect(target).toBeFocused();
      await expect(target.locator(".issue-title, .row-title").first()).toContainText("Child target");
      expect(popup.popupCount()).toBe(popupsBefore);
      await target.screenshot({ path: info.outputPath(`${viewport.width}-${mode.toLowerCase()}-${combined ? "combined" : "split"}-child-highlight.png`) });
      }
    }
  }
});

test("child navigation fits touch phones in portrait, landscape and narrow layouts", async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: devOrigin, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, locale: "sv-SE" });
  try {
    const page = await context.newPage();
    const popup = await fixture(page);
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(size);
      for (const mode of ["Cards", "List"] as const) {
        const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
        if (mode === "Cards") await split.check(); else await split.uncheck();
        await page.locator(".board-mode-toggle").locator(`[title="${mode === "List" ? "Lista" : "Kort"}"]`).click();
        const parent = page.locator('[id="issue-sample%2Fparent-42"]');
        if (mode === "List") await parent.locator(".row-title").click();
        else await parent.getByRole("button", { name: "Läs mer", exact: true }).click();
        const details = mode === "List" ? page.getByRole("dialog", { name: "Parent target" }) : parent;
        const childLink = details.locator(".issue-sub-issues button");
        await expect(childLink).toContainText("Child target");
        const popupsBefore = popup.popupCount();
        await childLink.click();
        const target = page.locator('[id="issue-sample%2Fparent-43"]');
        await expect(target).toBeVisible();
        await expect(target).toHaveClass(/issue-navigation-highlight/);
        await expect(target).toBeFocused();
        expect(popup.popupCount()).toBe(popupsBefore);
        await target.screenshot({ path: info.outputPath(`${size.width}x${size.height}-${mode.toLowerCase()}-child-highlight.png`) });
      }
    }
  } finally { await context.close(); }
});
