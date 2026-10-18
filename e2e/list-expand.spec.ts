import { expect, test, type Page } from "@playwright/test";

const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional expand fixture", private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
const stamp = new Date(Date.now() - 86_400_000).toISOString();
const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("desktop expands row details in place with open description while phone opens the full card in a popup", async ({ page, context }) => {
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
  await page.setViewportSize({ width: 1280, height: 900 });
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
  const row2 = alpha.locator(".issue-row").filter({ has: page.getByRole("button", { name: "alpha task 2", exact: true }) });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  const panel = page.locator("#" + await toggle.getAttribute("aria-controls"));
  await expect(panel).toBeVisible();
  // #155: on desktop the row keeps its header columns and shows all details with description already expanded, without a nested bordered card header.
  await expect(row2.locator(".row-meta .label")).toHaveText(["enhancement"]);
  await expect(row2.locator(".row-time")).toBeVisible();
  const detailsCard = panel.locator(".issue-card.row-details-card");
  await expect(detailsCard).toBeVisible();
  await expect(detailsCard.locator(".card-top")).toHaveCount(0);
  await expect(detailsCard.locator(".issue-title")).toHaveCount(0);
  await expect(detailsCard.getByRole("link", { name: /Parent plan/ })).toBeVisible();
  await expect(detailsCard.getByText("Description of alpha task 2")).toBeVisible();
  await expect(detailsCard.getByRole("button", { name: "Visa mindre", exact: true })).toHaveAttribute("aria-expanded", "true");

  // Several rows may be open on desktop; tapping a row's empty area toggles it too.
  const first = alpha.getByRole("button", { name: "alpha task 1", exact: true });
  await alpha.locator(".issue-row").filter({ has: page.getByRole("button", { name: "alpha task 1", exact: true }) }).locator(".row-time").click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(alpha.locator(".issue-row .row-details-card")).toHaveCount(2);
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

  // Combined board on desktop & tablet: keeps the repository badge on the row and expands details with open description.
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const board = page.locator(".combined-board");
  await expect(board.locator(".issue-row")).toHaveCount(4);
  const beta = board.getByRole("button", { name: "beta task 1", exact: true });
  await beta.click();
  await expect(beta).toHaveAttribute("aria-expanded", "true");
  const betaRow = board.locator(".issue-row").filter({ has: page.getByRole("button", { name: "beta task 1", exact: true }) });
  await expect(betaRow.locator(".row-repository")).toHaveText("sample/beta");
  await expect(betaRow.getByText("Description of beta task 1")).toBeVisible();
  await expect(betaRow.getByRole("link", { name: "Öppna #1 på GitHub", exact: true })).toHaveAttribute("href", "https://github.com/sample/beta/issues/1");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await noPageScroll(page)).toBe(true);
      const [rowBox, cardBox] = await Promise.all([betaRow.boundingBox(), betaRow.locator(".issue-card").boundingBox()]);
      expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
    }
  }
  await beta.click();
  await expect(beta).toHaveAttribute("aria-expanded", "false");

  // #155: on phones (<= 650px), tapping a row opens a popup dialog showing the full card identical to card view.
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await beta.click();
      await expect(beta).toHaveAttribute("aria-expanded", "true");
      await expect(betaRow.locator(".row-card")).toHaveCount(0);
      const dialog = page.getByRole("dialog", { name: "beta task 1", exact: true });
      await expect(dialog).toBeVisible();
      const popupCard = dialog.locator(".issue-card:not(.row-details-card)");
      await expect(popupCard).toBeVisible();
      await expect(popupCard.locator(".card-repository")).toHaveText("sample/beta");
      await expect(popupCard.getByRole("link", { name: /beta task 1/ })).toHaveAttribute("href", "https://github.com/sample/beta/issues/1");
      await expect(popupCard.locator(".label")).toHaveText(["enhancement"]);
      expect(await noPageScroll(page)).toBe(true);

      // #159: on mobile, close is an X button in the top-right corner inside the card, no separate button below.
      await expect(dialog.locator(".row-close")).toHaveCount(0);
      const closeBtn = dialog.locator(".row-popup-close");
      await expect(closeBtn).toBeVisible();
      await expect(closeBtn).toHaveAttribute("aria-label", "Stäng");
      const [closeBox, cardBox, repoBox] = await Promise.all([
        closeBtn.boundingBox(),
        popupCard.boundingBox(),
        popupCard.locator(".card-repository").boundingBox(),
      ]);
      expect(closeBox!.width).toBeGreaterThanOrEqual(44);
      expect(closeBox!.height).toBeGreaterThanOrEqual(44);
      expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
      expect(closeBox!.y).toBeGreaterThanOrEqual(cardBox!.y);
      expect(repoBox!.x + repoBox!.width).toBeLessThanOrEqual(closeBox!.x + 1);

      if (width === 320) {
        await page.keyboard.press("Escape");
      } else if (width === 390) {
        await page.locator(".row-popup-backdrop").click({ position: { x: 4, y: 4 } });
      } else {
        await dialog.getByRole("button", { name: "Stäng", exact: true }).click();
      }
      await expect(dialog).toHaveCount(0);
      await expect(beta).toHaveAttribute("aria-expanded", "false");
      await expect(beta).toBeFocused();
    }
  }

  // Expanded state is in-memory only.
  await page.setViewportSize({ width: 390, height: 844 });
  await beta.click();
  await expect(page.getByRole("dialog", { name: "beta task 1", exact: true })).toBeVisible();
  await page.reload();
  await expect(board.locator(".issue-row")).toHaveCount(4);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(popups).toHaveLength(1);
  expect(errors).toEqual([]);
});
