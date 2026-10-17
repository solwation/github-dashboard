import { expect, test, type Page } from "@playwright/test";

const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional expand fixture", private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
const stamp = new Date(Date.now() - 86_400_000).toISOString();
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("tapping a list row expands the full card in place in split and combined view without opening GitHub", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const relationRequests: number[] = [];
  await context.route("https://github.com/**", route => route.fulfill({ contentType: "text/html", body: "<title>GitHub stub</title>" }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`));
    if (url.pathname === "/user") return route.fulfill({ json: { login: "expand-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname === "/graphql") {
      const { variables } = route.request().postDataJSON();
      relationRequests.push(variables.number);
      return route.fulfill({ json: { data: { repository: { issue: {
        parent: variables.number === 2 ? { number: 1, title: "Parent plan", url: "https://github.com/sample/alpha/issues/1" } : null,
        subIssuesSummary: { total: 0, completed: 0 } } } } } });
    }
    if (repo && url.pathname.endsWith("/issues")) {
      const issues = [1, 2].map(number => ({ id: number, number, title: `${repo.name} task ${number}`, body: `Description of ${repo.name} task ${number}`, comments: 0,
        state: "open", created_at: stamp, updated_at: stamp, closed_at: null, html_url: `${repo.html_url}/issues/${number}`, assignees: [],
        labels: [{ name: "enhancement", color: "a2eeef" }] }));
      return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : issues });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-expand-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
  const alpha = page.locator("#repo-1");
  await expect(alpha.locator(".issue-row")).toHaveCount(2);
  const popups: string[] = []; context.on("page", popup => popups.push(popup.url()));
  // Rows load no card data until expanded (card view had loaded relations before the switch).
  relationRequests.length = 0;
  await page.waitForTimeout(300);
  expect(relationRequests).toEqual([]);

  const toggle = alpha.getByRole("button", { name: "alpha task 2", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  const panel = page.locator("#" + await toggle.getAttribute("aria-controls"));
  const card = panel.locator(".issue-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: /alpha task 2/ })).toHaveAttribute("href", "https://github.com/sample/alpha/issues/2");
  await expect(card.getByRole("link", { name: /Parent plan/ })).toBeVisible();
  await expect(card.locator(".label")).toHaveText(["enhancement"]);
  await card.getByRole("button", { name: "Läs mer", exact: true }).click();
  await expect(card.getByText("Description of alpha task 2")).toBeVisible();
  await expect(card.locator(".card-repository")).toHaveCount(0);
  // Several rows may be open; tapping a row's empty area toggles it too.
  const first = alpha.getByRole("button", { name: "alpha task 1", exact: true });
  await alpha.locator(".issue-row").filter({ has: page.getByRole("button", { name: "alpha task 1", exact: true }) }).locator(".row-time").click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(alpha.locator(".issue-row .issue-card")).toHaveCount(2);
  // Stäng collapses and returns focus to the row; tapping the header row collapses too.
  await panel.getByRole("button", { name: "Stäng", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  // Keyboard: Space and Enter toggle the row button.
  await toggle.focus(); await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(popups).toEqual([]);

  // The separate GitHub link opens a new tab and does not expand the row.
  const link = alpha.getByRole("link", { name: "Öppna #2 på GitHub", exact: true });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("href", "https://github.com/sample/alpha/issues/2");
  await toggle.focus(); await page.keyboard.press("Shift+Tab");
  await expect(link).toBeFocused();
  const popup = context.waitForEvent("page");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await popup).url()).toBe("https://github.com/sample/alpha/issues/2");
  await (await popup).close();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  // Combined board: same card with the repository, and the repository column remains.
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const board = page.locator(".combined-board");
  await expect(board.locator(".issue-row")).toHaveCount(4);
  const beta = board.getByRole("button", { name: "beta task 1", exact: true });
  await beta.click();
  await expect(beta).toHaveAttribute("aria-expanded", "true");
  const row = board.locator(".issue-row").filter({ has: page.getByRole("button", { name: "beta task 1", exact: true }) });
  await expect(row.locator(".row-repository")).toHaveText("sample/beta");
  await expect(row.locator(".issue-card .card-repository")).toHaveText("sample/beta");
  await expect(row.getByRole("link", { name: "Öppna #1 på GitHub", exact: true })).toHaveAttribute("href", "https://github.com/sample/beta/issues/1");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 430, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await noPageScroll(page)).toBe(true);
      const [rowBox, cardBox] = await Promise.all([row.boundingBox(), row.locator(".issue-card").boundingBox()]);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
    }
  }
  // Expanded state is in-memory only.
  await page.reload();
  await expect(board.locator(".issue-row")).toHaveCount(4);
  await expect(board.locator(".issue-row .issue-card")).toHaveCount(0);
  expect(popups).toHaveLength(1);
  expect(errors).toEqual([]);
});
