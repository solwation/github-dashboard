import { expect, test } from "@playwright/test";

const sizes = [
  { width: 390, height: 844, mobile: true },
  { width: 320, height: 568, mobile: true },
  { width: 844, height: 390, mobile: true },
  { width: 1000, height: 900, mobile: false },
  { width: 1600, height: 1000, mobile: false },
] as const;

async function enterDemo(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
}

async function checkTarget(page: import("@playwright/test").Page, id: string) {
  const target = page.locator(`#${id}`);
  await expect(target).toBeFocused();
  const bounds = (await target.boundingBox())!;
  const header = (await page.locator(".topbar").boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
}

test("mobile repository/status navigator works across the Cards/List viewport matrix", async ({ browser }, info) => {
  for (const size of sizes) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      isMobile: size.mobile,
      hasTouch: size.mobile,
      locale: "sv-SE",
    });
    const page = await context.newPage();
    await enterDemo(page);

    if (size.mobile) {
      await expect(page.locator(".mobile-board-navigator-toggle")).toBeVisible();
      expect((await page.locator(".topbar").boundingBox())!.height).toBeLessThanOrEqual(80);
    } else {
      await expect(page.locator(".mobile-board-navigator-toggle")).toBeHidden();
    }

    for (const mode of ["Kort", "Lista"] as const) {
      await page.getByRole("group", { name: "Visningsläge för boarden", exact: true })
        .getByRole("button", { name: mode, exact: true }).click();
      await expect(page.locator(mode === "Kort" ? ".issue-card" : ".issue-row").first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${size.width}x${size.height}-${mode}-split.png`) });

      if (size.mobile) {
        const navigator = page.locator("#mobile-board-navigator");
        const toggle = page.locator(".mobile-board-navigator-toggle");
        const targetLane = page.locator("#repo-2");
        await targetLane.locator(".collapse-project").click();
        await expect(targetLane).toHaveClass(/is-collapsed/);

        await toggle.click();
        await expect(navigator).toBeVisible();
        const repository = navigator.getByRole("combobox", { name: "Välj repository" });
        await repository.selectOption("demo/weekend-project");
        if (size.width === 320 && mode === "Lista") {
          await page.screenshot({ path: info.outputPath("320x568-list-navigator-open.png") });
        }
        const statuses = navigator.locator(".mobile-board-status");
        const backlogStatus = statuses.nth(0);
        const expectedCount = await targetLane.locator(".backlog .column-count").textContent();
        await expect(backlogStatus).toHaveAttribute("aria-label", `Backlog, ${expectedCount} ärenden`);
        await backlogStatus.click();
        await expect(navigator).toBeHidden();
        await expect(targetLane).not.toHaveClass(/is-collapsed/);
        await checkTarget(page, "board-2-backlog");
        await page.screenshot({ path: info.outputPath(`${size.width}x${size.height}-${mode}-split-navigation.png`) });

        await page.locator("#issue-search input").fill("filtrering");
        await toggle.click();
        await expect(navigator.locator(".mobile-board-status").nth(1)).toHaveAttribute("aria-label", "Pågående, 1 ärende");
        await navigator.locator(".mobile-board-status").nth(1).click();
        await expect(page.locator("#issue-search input")).toHaveValue("filtrering");
        await expect(targetLane.locator(".progress .column-count")).toHaveText("1");

        // Filtered zero-count groups remain visible and are clearly unavailable.
        await page.locator("#issue-search input").fill("no-match-from-mobile-navigator");
        await toggle.click();
        await expect(statuses).toHaveCount(3);
        for (const status of await statuses.all()) {
          await expect(status).toBeDisabled();
          await expect(status).toContainText("0");
        }
        await toggle.click();
        await page.locator("#issue-search input").fill("");

        // Combined mode uses one count set for the filtered board, with repository labels in context.
        await page.getByLabel("Dela upp per repository").uncheck();
        await toggle.click();
        await expect(navigator.getByRole("combobox")).toHaveCount(0);
        const combinedBacklogCount = await page.locator(".combined-board .backlog .column-count").textContent();
        await expect(navigator.locator(".mobile-board-status").first())
          .toHaveAttribute("aria-label", `Backlog, ${combinedBacklogCount} ärenden`);
        await navigator.locator(".mobile-board-status").first().click();
        await checkTarget(page, "board-combined-backlog");
        await page.screenshot({ path: info.outputPath(`${size.width}x${size.height}-${mode}-combined-navigation.png`) });
        await page.getByLabel("Dela upp per repository").check();
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await context.close();
  }
});

test("navigation preserves expanded batches, unread activity and detail return position", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "sv-SE" });
  const page = await context.newPage();
  const created = new Date(Date.now() - 86_400_000).toISOString();
  const repo = { id: 77, name: "navigator-fixture", full_name: "sample/navigator-fixture", private: false, description: "Fictional navigation fixture", html_url: "https://github.com/sample/navigator-fixture", owner: { login: "sample" } };
  let moved = false;
  let updated = created;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let result: unknown = [];
    if (url.pathname === "/user") result = { login: "navigator-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") result = [repo];
    else if (url.pathname.endsWith("/issues") && url.searchParams.get("state") !== "closed") {
      result = Array.from({ length: 12 }, (_, index) => {
        const inProgress = moved && index === 0;
        return {
          id: index + 1, number: index + 1, title: `Fictional task ${index + 1}`, body: "Preserve position while navigating.",
          comments: 0, state: "open", closed_at: null,
          labels: inProgress ? [{ name: "in-progress", color: "147d69" }] : [], assignees: [],
          html_url: `${repo.html_url}/issues/${index + 1}`, created_at: created, updated_at: inProgress ? updated : created,
        };
      });
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-navigator-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await page.getByRole("group", { name: "Visningsläge för boarden", exact: true }).getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator("#repo-77 .backlog .issue-row")).toHaveCount(6);

  const toggle = page.locator(".mobile-board-navigator-toggle");
  await toggle.click();
  await page.locator("#mobile-board-navigator .mobile-board-status").nth(0).click();
  const backlog = page.locator("#repo-77 .backlog");
  const showMore = backlog.getByRole("button", { name: "Visa fler" });
  await showMore.scrollIntoViewIfNeeded();
  const scrollBeforeMore = await page.evaluate(() => window.scrollY);
  await showMore.click();
  await expect(page.locator("#repo-77 .backlog .issue-row")).toHaveCount(12);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeMore);

  moved = true;
  updated = new Date().toISOString();
  await page.keyboard.press("Control+r");
  await expect(page.locator("#repo-77 .progress .unread-move")).toHaveCount(1);
  await toggle.click();
  await page.locator("#mobile-board-navigator .mobile-board-status").nth(1).click();
  await checkTarget(page, "board-77-progress");
  await expect(page.locator("#repo-77 .progress .unread-move")).toHaveCount(1);

  await toggle.click();
  await page.locator("#mobile-board-navigator .mobile-board-status").nth(0).click();
  await checkTarget(page, "board-77-backlog");
  await expect(page.locator("#repo-77 .backlog .issue-row")).toHaveCount(11);

  const detailRow = page.locator("#repo-77 .backlog .issue-row").filter({ hasText: "Fictional task 2" });
  await detailRow.scrollIntoViewIfNeeded();
  const detailScroll = await page.evaluate(() => window.scrollY);
  await detailRow.getByRole("button", { name: "Fictional task 2" }).click();
  const popup = page.getByRole("dialog", { name: "Fictional task 2" });
  await expect(popup).toBeVisible();
  await popup.getByRole("button", { name: "Stäng" }).click();
  await expect(popup).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(detailScroll);
  await expect(page.locator("#repo-77 .progress .unread-move")).toHaveCount(1);
  await context.close();
});

test("navigator labels and keyboard dismissal follow the selected language", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "en-GB" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Explore a demo", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Jump to repository or status" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const navigator = page.getByRole("group", { name: "Quick navigation between repositories and statuses" });
  await expect(navigator).toBeVisible();
  const repository = navigator.getByRole("combobox", { name: "Choose repository" });
  await page.keyboard.press("Tab");
  await expect(repository).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(navigator).toBeHidden();
  await expect(toggle).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(navigator.getByRole("button", { name: "Backlog, 3 issues" })).toBeEnabled();
  await navigator.getByRole("button", { name: "Backlog, 3 issues" }).press("Enter");
  await checkTarget(page, "board-1-backlog");
  await context.close();
});

