import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import { encodeHandoff } from "../src/lib/handoff";

const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("one global list mode for every repository and the combined board keeps filters, limits, colors, keyboard and mobile layout", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const design = page.locator("#repo-1"), weekend = page.locator("#repo-2");
  // #147: one toolbar toggle, none left in repository or combined-board headers.
  const toggle = page.locator(".board-toolbar").getByRole("group", { name: "Visningsläge för boarden", exact: true });
  await expect(page.getByRole("group", { name: /^Visningsläge/ })).toHaveCount(1);
  await expect(page.locator(".lane-actions .board-mode-toggle")).toHaveCount(0);
  // No stray template text (e.g. a dangling ">") between the toolbar controls.
  expect(await page.locator(".board-toolbar").first().evaluate(node =>
    [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent!.trim()).join(""))).toBe("");
  await expect(toggle.getByRole("button", { name: "Kort", exact: true })).toHaveAttribute("aria-pressed", "true");
  await toggle.getByRole("button", { name: "Lista", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(toggle.getByRole("button", { name: "Lista", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(toggle.getByRole("button", { name: "Kort", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(design.locator(".issue-row")).toHaveCount(8);
  await expect(design.locator(".issue-card")).toHaveCount(0);
  await expect(weekend.locator(".issue-row")).toHaveCount(5);
  await expect(weekend.locator(".issue-card")).toHaveCount(0);
  // Split lanes already name their repository (#119).
  await expect(page.locator(".row-repository")).toHaveCount(0);
  const progress = design.locator(".progress .issue-row");
  await expect(progress).toHaveCount(1);
  await expect(progress.locator(".row-number")).toHaveText("#119");
  await expect(progress.locator(".row-title")).toHaveText("Samla färger i gemensamma designtokens");
  await expect(progress.locator(".row-status")).toHaveText("Pågående");
  await expect(progress.locator(".timer")).toBeVisible();
  // #198/#199: neither the in-progress label nor the type label (shown as the icon) is repeated in the row.
  await expect(progress.locator(".label")).toHaveCount(0);
  await expect(progress.locator(".type-circle.type-feature")).toHaveAttribute("title", "Typ: Funktion");
  const rowHeight = (await design.locator(".backlog .issue-row").first().boundingBox())!.height;
  await toggle.getByRole("button", { name: "Kort", exact: true }).click();
  const cardHeight = (await design.locator(".backlog .issue-card").first().boundingBox())!.height;
  expect(rowHeight * 2).toBeLessThan(cardHeight);
  await toggle.getByRole("button", { name: "Lista", exact: true }).click();

  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("tangentbord");
  await expect(design.locator(".issue-row")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Sök issues", exact: true }).fill("");
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Visa max work items per kolumn", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await expect(design.locator(".closed .issue-row")).toHaveCount(2);
  await design.locator(".closed").getByRole("button", { name: "Visa fler", exact: true }).click();
  await expect(design.locator(".closed .issue-row")).toHaveCount(4);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await noPageScroll(page)).toBe(true);
    await expect(toggle.getByRole("button", { name: "Lista", exact: true })).toBeInViewport();
  }
  // #151: on desktop the toggle takes the toolbar's far-right slot, without horizontal scroll.
  for (const width of [768, 800, 950, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await noPageScroll(page)).toBe(true);
    // Only the view toggle is pushed right; the checkboxes stay packed on the left (#151).
    expect(await page.locator(".board-toolbar .coord-toggle").evaluateAll(nodes => nodes.map(node => getComputedStyle(node).marginLeft))).toEqual(["0px", "0px"]);
    const edges = await page.locator(".board-toolbar").evaluate(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      const toggle = node.querySelector(".board-mode-toggle")!.getBoundingClientRect();
      return { gap: box.right - parseFloat(style.paddingRight) - toggle.right, last: node.lastElementChild!.classList.contains("board-mode-toggle") };
    });
    expect(edges.last).toBe(true);
    expect(Math.abs(edges.gap)).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  const split = page.getByRole("checkbox", { name: "Dela upp per repository", exact: true });
  await split.uncheck();
  const board = page.locator(".combined-board");
  const shared = toggle;
  await expect(board.locator(".board-mode-toggle")).toHaveCount(0);
  // The global choice carries over to the combined board.
  await expect(board.locator(".issue-row")).toHaveCount(6);
  await expect(board.locator(".issue-card")).toHaveCount(0);
  const colors = await page.locator(".sidebar-repository-row").evaluateAll(rows => Object.fromEntries(rows.map(row =>
    [row.getAttribute("data-repository"), getComputedStyle(row.querySelector(".repo-dot")!).backgroundColor])));
  for (const row of await board.locator(".issue-row").all()) {
    const name = (await row.locator(".row-repository").getAttribute("title"))!;
    expect(await row.locator(".row-repository i").evaluate(element => getComputedStyle(element).backgroundColor)).toBe(colors[name]);
  }
  await board.locator(".backlog").getByRole("button", { name: "Visa fler", exact: true }).click();
  await expect(board.locator(".backlog .issue-row")).toHaveCount(4);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await noPageScroll(page)).toBe(true);
    await expect(board.locator(".row-repository").first()).toBeVisible();
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await board.locator(".issue-row").first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(28, 40, 44)");
  await shared.getByRole("button", { name: "Kort", exact: true }).click();
  await expect(board.locator(".issue-row")).toHaveCount(0);
  await split.check();
  await expect(design.locator(".issue-row")).toHaveCount(0);
  await expect(design.locator(".issue-card")).toHaveCount(7);
  await expect(weekend.locator(".issue-card")).toHaveCount(5);
});

test("list choices persist in encrypted settings, travel by QR and keep timeout and movement markers", async ({ page }) => {
  const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional list fixture", private: true, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  const created = new Date(Date.now() - 86_400_000).toISOString();
  const started = new Date(Date.now() - 31 * 60_000).toISOString();
  let moved = false, updated = created;
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`));
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "list-fixture", avatar_url: "" };
    else if (url.pathname === "/user/repos") data = repos;
    else if (url.pathname.endsWith("/events")) data = [{ id: 1, event: "labeled", created_at: started, label: { name: "in-progress" } }];
    else if (repo && url.pathname.endsWith("/issues")) {
      const titles = ["waiting work", "slow work", "finished work"];
      data = [1, 2, 3, 4, 5].map(number => ({ id: number, number, title: `${repo.name} ${titles[Math.min(number - 1, 2)]}`, body: "", comments: 0,
        state: number >= 3 ? "closed" : "open", created_at: created, updated_at: number === 1 ? updated : created,
        closed_at: number >= 3 ? created : null, workStartedAt: number >= 3 ? new Date(Date.parse(created) - 20 * 60000).toISOString() : undefined, html_url: `${repo.html_url}/issues/${number}`, assignees: [],
        labels: number === 2 || (number === 1 && moved) ? [{ name: "in-progress", color: "147d69" }] : [] }))
        .filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state"));
    }
    await route.fulfill({ json: data });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-list-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  for (const repo of repos) await page.getByRole("dialog").getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(10);
  const alpha = page.locator("#repo-1"), beta = page.locator("#repo-2");
  const toggle = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  await toggle.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(alpha.locator(".issue-row")).toHaveCount(5);
  await expect(beta.locator(".issue-row")).toHaveCount(5);
  const slow = alpha.locator(".issue-row").filter({ has: page.getByRole("button", { name: "alpha slow work" }) });
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(slow.locator(".row-timeout")).toHaveAttribute("title", /över estimatet ≈ 20 min plus 25 %/);
  // #154: the title expands the row; the number is the separate GitHub link.
  await expect(slow.getByRole("button", { name: "alpha slow work" })).toHaveAttribute("aria-expanded", "false");
  await expect(slow.getByRole("link", { name: "Öppna #2 på GitHub", exact: true })).toHaveAttribute("href", "https://github.com/sample/alpha/issues/2");

  moved = true; updated = new Date().toISOString();
  await page.keyboard.press("Control+r");
  const waiting = alpha.locator(".issue-row").filter({ has: page.getByRole("button", { name: "alpha waiting work" }) });
  await expect(waiting).toHaveClass(/unread-move/);
  const marker = waiting.getByRole("button", { name: "Nyligen flyttad. Markera som läst", exact: true });
  await expect(marker).toContainText("Flyttad");
  await marker.focus(); await page.keyboard.press("Enter");
  await expect(waiting).not.toHaveClass(/unread-move/);

  await expect.poll(() => readSettings(page, "list-fixture").then(saved => saved?.preferences?.listMode)).toBe(true);
  const stored = await readSettings(page, "list-fixture");
  expect(stored?.preferences).not.toHaveProperty("listRepos");
  expect(stored?.preferences).not.toHaveProperty("combinedList");
  await page.reload();
  await expect(alpha.locator(".issue-row")).toHaveCount(5);
  await expect(beta.locator(".issue-row")).toHaveCount(5);
  await expect(toggle.getByRole("button", { name: "Lista", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const board = page.locator(".combined-board");
  await expect(board.locator(".issue-row")).toHaveCount(10);
  const names = await board.locator(".row-repository").evaluateAll(elements => elements.map(element => element.getAttribute("title")));
  expect(new Set(names)).toEqual(new Set(["sample/alpha", "sample/beta"]));
  await page.reload();
  await expect(board.locator(".issue-row")).toHaveCount(10);
  await expect(page.getByRole("checkbox", { name: "Dela upp per repository", exact: true })).not.toBeChecked();

  // An older QR code with #127's per-repository choices migrates to the global mode (strict majority).
  const transfer = encodeHandoff({ token: "fictional-list-token", selected: ["sample/alpha", "sample/beta"], rules: {}, preferences: { splitByRepository: true, listRepos: ["sample/beta"], combinedList: true } });
  const warnings: string[] = [];
  page.on("console", message => { if (["warning", "error"].includes(message.type())) warnings.push(message.text()); });
  await page.goto("about:blank");
  await page.goto("/#issueflow-handoff=" + transfer);
  await expect(alpha.locator(".issue-card")).toHaveCount(5);
  await expect(beta.locator(".issue-card")).toHaveCount(5);
  await expect.poll(() => readSettings(page, "list-fixture").then(saved => saved?.preferences?.listMode)).toBe(false);
  const current = encodeHandoff({ token: "fictional-list-token", selected: ["sample/alpha", "sample/beta"], rules: {}, preferences: { splitByRepository: true, listRepos: ["sample/alpha", "sample/beta"] } });
  await page.goto("about:blank");
  await page.goto("/#issueflow-handoff=" + current);
  await expect(alpha.locator(".issue-row")).toHaveCount(5);
  await expect(beta.locator(".issue-row")).toHaveCount(5);
  expect(warnings).toEqual([]);
});
