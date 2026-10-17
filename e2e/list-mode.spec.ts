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
  await expect(progress.locator(".label")).toHaveText(["in-progress", "enhancement"]);
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
    const name = (await row.locator(".row-repository").textContent())!.trim();
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
      data = [1, 2, 3].map(number => ({ id: number, number, title: `${repo.name} ${titles[number - 1]}`, body: "", comments: 0,
        state: number === 3 ? "closed" : "open", created_at: created, updated_at: number === 1 ? updated : created,
        closed_at: number === 3 ? created : null, html_url: `${repo.html_url}/issues/${number}`, assignees: [],
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
  await expect(page.locator(".issue-card")).toHaveCount(6);
  const alpha = page.locator("#repo-1"), beta = page.locator("#repo-2");
  const toggle = page.getByRole("group", { name: "Visningsläge för boarden", exact: true });
  await toggle.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(alpha.locator(".issue-row")).toHaveCount(3);
  await expect(beta.locator(".issue-row")).toHaveCount(3);
  const slow = alpha.locator(".issue-row").filter({ has: page.getByRole("link", { name: "alpha slow work" }) });
  await expect(slow).toHaveClass(/issue-timeout/);
  await expect(slow.locator(".row-timeout")).toHaveAttribute("title", /över gränsen 30 min/);
  await expect(slow.getByRole("link", { name: "alpha slow work" })).toHaveAttribute("href", "https://github.com/sample/alpha/issues/2");

  moved = true; updated = new Date().toISOString();
  await page.keyboard.press("Control+r");
  const waiting = alpha.locator(".issue-row").filter({ has: page.getByRole("link", { name: "alpha waiting work" }) });
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
  await expect(alpha.locator(".issue-row")).toHaveCount(3);
  await expect(beta.locator(".issue-row")).toHaveCount(3);
  await expect(toggle.getByRole("button", { name: "Lista", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const board = page.locator(".combined-board");
  await expect(board.locator(".issue-row")).toHaveCount(6);
  const names = (await board.locator(".row-repository").allTextContents()).map(name => name.trim());
  expect(new Set(names)).toEqual(new Set(["sample/alpha", "sample/beta"]));
  await page.reload();
  await expect(board.locator(".issue-row")).toHaveCount(6);
  await expect(page.getByRole("checkbox", { name: "Dela upp per repository", exact: true })).not.toBeChecked();

  // An older QR code with #127's per-repository choices migrates to the global mode (strict majority).
  const transfer = encodeHandoff({ token: "fictional-list-token", selected: ["sample/alpha", "sample/beta"], rules: {}, preferences: { splitByRepository: true, listRepos: ["sample/beta"], combinedList: true } });
  const warnings: string[] = [];
  page.on("console", message => { if (["warning", "error"].includes(message.type())) warnings.push(message.text()); });
  await page.goto("about:blank");
  await page.goto("/#issueflow-handoff=" + transfer);
  await expect(alpha.locator(".issue-card")).toHaveCount(3);
  await expect(beta.locator(".issue-card")).toHaveCount(3);
  await expect.poll(() => readSettings(page, "list-fixture").then(saved => saved?.preferences?.listMode)).toBe(false);
  const current = encodeHandoff({ token: "fictional-list-token", selected: ["sample/alpha", "sample/beta"], rules: {}, preferences: { splitByRepository: true, listRepos: ["sample/alpha", "sample/beta"] } });
  await page.goto("about:blank");
  await page.goto("/#issueflow-handoff=" + current);
  await expect(alpha.locator(".issue-row")).toHaveCount(3);
  await expect(beta.locator(".issue-row")).toHaveCount(3);
  expect(warnings).toEqual([]);
});
