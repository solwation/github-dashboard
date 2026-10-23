import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import { encodeHandoff } from "../src/lib/handoff";
import { openSettings } from "./support/phone-menu";

async function matchingColors(page: Page) {
  const colors = await page.locator(".sidebar-repository-row").evaluateAll(rows => Object.fromEntries(rows.map(row => [row.getAttribute("data-repository"), getComputedStyle(row.querySelector(".repo-dot")!).backgroundColor])));
  // Split lanes already name their repository, so only the combined board labels each card.
  if (await page.locator(".repo-lane").count()) {
    await expect(page.locator(".repo-lane .issue-card").first()).toBeVisible();
    await expect(page.locator(".card-repository")).toHaveCount(0);
    return colors;
  }
  await expect(page.locator(".combined-board .issue-card .card-repository")).toHaveCount(await page.locator(".combined-board .issue-card").count());
  for (const card of await page.locator(".issue-card").all()) {
    const name = (await card.locator(".card-repository").getAttribute("title"))!;
    expect(await card.locator(".card-repository i").evaluate(element => getComputedStyle(element).backgroundColor)).toBe(colors[name]);
  }
  return colors;
}

test("split defaults on; combined columns use only the main search, keep colors, keyboard controls and mobile layout", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
  await expect(split).toBeChecked(); await expect(page.locator(".repo-lane")).toHaveCount(3);
  const colors = await matchingColors(page);
  await openSettings(page);
  await page.getByLabel("Visa max work items per kolumn", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  const openStat = page.locator('[data-stat="open"] strong');
  await page.getByRole("textbox", { name: "Filtrera issues i demo/design-system", exact: true }).fill("missing");
  await expect(openStat).not.toHaveText(/^9(?!\d)/);
  await split.focus(); await page.keyboard.press("Space");
  const board = page.locator(".combined-board");
  await expect(board.locator(".board-column")).toHaveCount(3);
  await expect(page.locator(".repo-lane")).toHaveCount(0);
  // Saved per-repository searches neither show up nor filter the combined board or its overview (#132).
  await expect(board.locator('[id^="combined-filter-"]')).toHaveCount(0);
  await expect(openStat).toHaveText(/^9(?!\d)/);
  await expect(board.locator(".backlog .column-count")).toHaveText("6");
  await expect(board.locator(".progress .column-count")).toHaveText("3");
  await expect(board.locator(".closed .column-count")).toHaveText("8");
  await expect(board.locator(".backlog .issue-card")).toHaveCount(5);
  await board.locator(".backlog").getByRole("button", { name: "Visa fler", exact: true }).click();
  await board.locator(".closed").getByRole("button", { name: "Visa fler", exact: true }).click();
  await expect(board.locator(".issue-card")).toHaveCount(17);
  expect(await matchingColors(page)).toEqual(colors);
  const sidebarProject = page.locator('.sidebar-repository-row[data-repository="demo/design-system"] .sidebar-repository');
  await sidebarProject.click();
  await expect(board.locator(".combined-repository-controls")).toHaveAttribute("open", "");
  await expect(board.locator(".combined-limit-note")).toBeVisible();
  await sidebarProject.click();
  await expect(board.locator(".combined-repository-controls")).not.toHaveAttribute("open", "");
  await sidebarProject.press("Enter");
  await expect(board.locator(".combined-repository-controls")).toHaveAttribute("open", "");
  await board.getByText("Repositoryinställningar", { exact: true }).click();
  await sidebarProject.click(); // The same hash must also reveal a manually closed panel.
  await expect(board.locator(".combined-repository-controls")).toHaveAttribute("open", "");
  await expect(page.getByRole("textbox", { name: "Filtrera issues i demo/design-system", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("startsidan");
  await expect(board.locator(".issue-card")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
  await page.locator(".sidebar-projects").getByRole("button", { name: /^Ordna weekend-project med/ }).focus();
  await page.keyboard.press("ArrowUp");
  expect(await matchingColors(page)).toEqual(colors);
  for (const width of [320, 390, 650]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await split.check();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
  await expect(page.getByRole("textbox", { name: "Filtrera issues i demo/design-system", exact: true })).toHaveValue("missing");
  await matchingColors(page);
  await openSettings(page);
  await page.getByRole("combobox", { name: "Språk", exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Split by repository", exact: true })).toBeChecked();
});

async function fixture(page: Page) {
  const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional combined board fixture", private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const now = new Date().toISOString();
  let release!: () => void;
  let holdBeta = false;
  let waiting: Promise<void> = Promise.resolve();
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "combined-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`));
    if (url.pathname.endsWith("/comments")) return route.fulfill({ json: [{ id: 10, body: `${repo!.name} independent comment`, html_url: `${repo!.html_url}/issues/1#issuecomment-10`, created_at: now, user: { login: "fictional-author" } }] });
    if (url.pathname.endsWith("/events")) return route.fulfill({ json: [{ id: 1, event: "labeled", created_at: now, label: { name: "in-progress" } }] });
    if (url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      if (repo!.name === "beta" && holdBeta) await waiting;
      const issues = [1, 2, 3].map(number => ({ id: number, number, title: `${repo!.name} task ${number}`, body: `${repo!.name} task description`, comments: 1, state: number === 3 ? "closed" : "open", created_at: now, updated_at: now, closed_at: number === 3 ? now : null, html_url: `${repo!.html_url}/issues/${number}`, labels: number === 2 ? [{ name: "in-progress", color: "147d69" }] : [], assignees: [] }));
      return route.fulfill({ json: issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state")) });
    }
    if (url.pathname === "/graphql") {
      const body = route.request().postDataJSON() as { query: string; variables: { name: string } };
      if (body.query.includes("ClosingCommit")) return route.fulfill({ json: { data: { repository: { issue: { state: "CLOSED", closedAt: now, timelineItems: { nodes: [{ createdAt: now, closer: { __typename: "Commit", oid: "abcdef123456789", url: `https://github.com/sample/${body.variables.name}/commit/abcdef123456789`, additions: 3, deletions: 1 } }] } } } } } });
      return route.fulfill({ json: { data: { repository: { issue: { parent: null, subIssuesSummary: null } } } } });
    }
    return route.fulfill({ json: [] });
  });
  return { repos, hold() { holdBeta = true; waiting = new Promise(resolve => { release = resolve; }); return () => { holdBeta = false; release(); }; } };
}
async function connect(page: Page, names: string[]) {
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-combined-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const name of names) await page.getByRole("dialog").getByRole("checkbox", { name: `sample/${name}` }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(names.length * 3);
}

test("combined cards with colliding IDs use their own comments, commits and persisted optical preference", async ({ page }) => {
  await fixture(page); await connect(page, ["alpha", "beta"]);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const board = page.locator(".combined-board"); await expect(board.locator(".issue-card")).toHaveCount(6);
  for (const name of ["alpha", "beta"]) {
    const card = board.locator(".issue-card").filter({ has: page.getByRole("link", { name: `${name} task 1`, exact: true }) });
    await card.getByRole("button", { name: "1 kommentarer" }).click();
    await expect(page.getByRole("dialog").getByText(`${name} independent comment`, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    const closed = board.locator(".issue-card").filter({ has: page.getByRole("link", { name: `${name} task 3`, exact: true }) });
    await closed.scrollIntoViewIfNeeded();
    await expect(closed.locator(".closing-commit a")).toHaveAttribute("href", `https://github.com/sample/${name}/commit/abcdef123456789`);
  }
  await expect.poll(() => readSettings(page, "combined-fixture").then(saved => saved?.preferences?.splitByRepository)).toBe(false);
  await page.reload(); await expect(page.locator(".combined-board .issue-card")).toHaveCount(6);
  await expect(page.getByRole("checkbox", { name: "Dela upp per repository", exact: true })).not.toBeChecked();
  const transferred = encodeHandoff({ token: "fictional-combined-token", selected: ["sample/alpha", "sample/beta"], rules: {}, preferences: { splitByRepository: true } });
  await page.goto("about:blank");
  await page.goto("/#issueflow-handoff=" + transferred);
  await expect(page.getByRole("checkbox", { name: "Dela upp per repository", exact: true })).toBeChecked();
  await expect(page.locator(".repo-lane")).toHaveCount(2);
  const combinedTransfer = encodeHandoff({ token: "fictional-combined-token", selected: ["sample/alpha", "sample/beta"], rules: {}, preferences: { splitByRepository: false } });
  await page.goto("about:blank");
  await page.goto("/#issueflow-handoff=" + combinedTransfer);
  await expect(page.getByRole("checkbox", { name: "Dela upp per repository", exact: true })).not.toBeChecked();
  await expect(page.locator(".combined-board .issue-card")).toHaveCount(6);
});

test("new repository selection appears as loading in combined mode while retained cards remain", async ({ page }) => {
  const api = await fixture(page); await connect(page, ["alpha"]);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const release = api.hold();
  await page.locator(".sidebar-add").click();
  await page.getByRole("dialog").getByRole("checkbox", { name: "sample/beta" }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".combined-board .repository-loading")).toContainText("sample/beta");
  await expect(page.locator(".combined-board .issue-card")).toHaveCount(3);
  await expect(page.locator(".sidebar-repository .repository-label")).toHaveText(["alpha", "beta"]);
  release(); await expect(page.locator(".combined-board .issue-card")).toHaveCount(6);
});
