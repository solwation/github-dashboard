import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import { openSettings } from "./support/phone-menu";

async function fixture(page: Page) {
  let account = "layout-alpha";
  let longTitle = false;
  let names = ["charlie", "alpha", "bravo"];
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const repos = names.map(name => ({
      id: { alpha: 1, bravo: 2, charlie: 3, aardvark: 4 }[name]!, name: longTitle && name === "charlie" ? "charlie-with-a-long-unbroken-repository-name" : name,
      full_name: `sample/${name}`, private: false, description: "Fictional layout fixture",
      html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
    }));
    let body: unknown = [];
    if (url.pathname === "/user") body = { login: account, avatar_url: "" };
    else if (url.pathname === "/user/repos") body = repos;
    else if (url.pathname.endsWith("/labels")) body = [{ name: "in-progress", color: "147d69" }];
    else if (url.pathname.endsWith("/issues")) {
      const closed = url.searchParams.get("state") === "closed";
      const date = new Date().toISOString();
      body = (closed ? [3] : [1, 2]).map(number => ({
        id: number, number, title: `Fixture task ${number}`, state: closed ? "closed" : "open",
        created_at: date, updated_at: date, closed_at: closed ? date : null,
        html_url: `${repos[0]!.html_url}/issues/${number}`, assignees: [],
        labels: number === 2 ? [{ name: "in-progress", color: "147d69" }] : [],
      }));
    }
    await route.fulfill({ json: body });
  });
  await page.addInitScript(() => {
    for (const login of ["layout-alpha", "layout-beta"]) {
      const key = `issueflow:${login}`;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ selected: ["sample/alpha", "sample/bravo", "sample/charlie"] }));
    }
  });
  return {
    longTitle: () => { longTitle = true; },
    account: (value: string) => { account = value; },
    addRepo: () => { names = ["aardvark", ...names]; },
  };
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-layout-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await expect(page.locator(".repo-lane")).toHaveCount(3);
}
async function expectOrder(page: Page, names: string[]) {
  await expect(page.locator(".repo-lane h2 a")).toHaveText(names);
  await expect(page.locator(".sidebar-repository .repository-label")).toHaveText(names);
}

test("drag and keyboard order stay in sync, survive refresh and reload, and remain local to each account", async ({ page }) => {
  const api = await fixture(page);
  await page.goto("/");
  await connect(page);
  await expectOrder(page, ["alpha", "bravo", "charlie"]);
  const sidebar = page.locator(".sidebar-projects");
  await expect(page.locator(".repo-lane .project-order-controls")).toHaveCount(0);
  await expect(sidebar.locator(".project-order-controls")).toHaveCount(0);
  await expect(sidebar.locator(".project-drag-handle")).toHaveCount(0);

  await openSettings(page, "Inställningar", false);
  const settings = page.locator('dialog[aria-labelledby="language-settings-title"]');
  await settings.getByRole("button", { name: "Ordna repositories", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ordna repositories", exact: true });
  await dialog.getByRole("button", { name: "Flytta charlie upp", exact: true }).click();
  await dialog.getByRole("button", { name: "Flytta charlie upp", exact: true }).click();
  await expectOrder(page, ["charlie", "alpha", "bravo"]);
  const handle = dialog.locator("li").nth(2).locator(".project-drag-handle");
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expectOrder(page, ["charlie", "bravo", "alpha"]);
  await expect(dialog.locator("li").nth(1).locator(".project-drag-handle")).toBeFocused();
  await dialog.getByRole("button", { name: "Klart", exact: true }).click();
  await settings.getByRole("button", { name: "Klart", exact: true }).click();

  await page.getByRole("button", { name: "Kollapsa bravo", exact: true }).click();
  await expect(page.locator("#repo-2 .swimlane")).toBeHidden();
  await expect(page.locator("#repo-2 .lane-summary")).toContainText("Backlog: 1");
  await expect(page.locator("#repo-2 .lane-summary")).toContainText("Pågående: 1");
  await expect(page.locator("#repo-2 .lane-summary")).toContainText("Stängda senaste 30 dagarna: 1");
  await page.keyboard.press("Control+r");
  await expectOrder(page, ["charlie", "bravo", "alpha"]);
  await page.reload();
  await expectOrder(page, ["charlie", "bravo", "alpha"]);
  await expect(page.getByRole("button", { name: "Expandera bravo", exact: true })).toHaveAttribute("aria-expanded", "false");
  api.addRepo();
  await page.reload();
  // Repositories discovered later append after existing positions when selected.
  await page.locator(".sidebar-add").click();
  await page.getByRole("checkbox", { name: "sample/aardvark" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expectOrder(page, ["charlie", "bravo", "alpha", "aardvark"]);
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  api.account("layout-beta");
  await connect(page);
  await expectOrder(page, ["alpha", "bravo", "charlie"]);
  await expect(page.getByRole("button", { name: "Kollapsa bravo", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => readSettings(page, "layout-alpha").then(saved => saved?.projectOrder?.slice(0, 3)))
    .toEqual(["sample/charlie", "sample/bravo", "sample/alpha"]);
});


test.describe("touch repository ordering in Settings", () => {
  test.use({ viewport: { width: 1100, height: 900 }, hasTouch: true });
  test("a real touch drag in settings dialog reorders repositories and persists after reload", async ({ page, context }) => {
    await fixture(page);
    await page.goto("/");
    await connect(page);
    await openSettings(page, "Inställningar", false);
    const settings = page.locator('dialog[aria-labelledby="language-settings-title"]');
    await settings.getByRole("button", { name: "Ordna repositories", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Ordna repositories", exact: true });
    const rows = dialog.locator("li");
    const handle = rows.nth(2).locator(".project-drag-handle");
    await expect(handle).toBeVisible();
    const source = (await handle.boundingBox())!;
    const target = (await rows.first().boundingBox())!;
    const client = await context.newCDPSession(page);
    const x = source.x + source.width / 2;
    const startY = source.y + source.height / 2;
    const endY = target.y + target.height / 2;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 10; step++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + (endY - startY) * step / 10 }] });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(rows.first()).toHaveAttribute("data-repository", "sample/charlie");
    await dialog.getByRole("button", { name: "Klart", exact: true }).click();
    await settings.getByRole("button", { name: "Klart", exact: true }).click();
    await expectOrder(page, ["charlie", "alpha", "bravo"]);
    await page.reload();
    await expectOrder(page, ["charlie", "alpha", "bravo"]);
  });
});

test.describe("phone layout controls", () => {
  test.use({ viewport: { width: 320, height: 844 }, hasTouch: true });
  test("phone content has no ordering controls and columns remain stacked", async ({ page }) => {
    const api = await fixture(page);
    await page.goto("/");
    await connect(page);
    await expect(page.locator(".sidebar-projects")).toBeHidden();
    await expect(page.locator(".repo-lane .project-order-controls")).toHaveCount(0);
    await expectOrder(page, ["alpha", "bravo", "charlie"]);
    await page.getByRole("button", { name: "Kollapsa bravo", exact: true }).tap();
    await expect(page.locator("#repo-2 .swimlane")).toBeHidden();
    await expect(page.locator("#repo-2 .lane-summary")).toBeVisible();
    await page.reload();
    await expectOrder(page, ["alpha", "bravo", "charlie"]);
    await page.getByRole("button", { name: "Expandera bravo", exact: true }).tap();
    await expect(page.locator("#repo-2 .swimlane")).toBeVisible();
    const columns = page.locator("#repo-2 .board-column");
    const first = (await columns.nth(0).boundingBox())!;
    const second = (await columns.nth(1).boundingBox())!;
    expect(second.x).toBeCloseTo(first.x, 0);
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    api.longTitle();
    await page.reload();
    await expect(page.locator("#repo-3 h2")).toContainText("charlie-with-a-long-unbroken-repository-name");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Translate the same accessible controls without changing the stored layout.
    await openSettings(page, "Inställningar", true);
    await page.getByLabel("Språk", { exact: true }).selectOption("en");
    await page.getByRole("button", { name: "Done", exact: true }).tap();
    await page.reload();
    await expect(page.getByRole("button", { name: "Collapse bravo", exact: true })).toBeVisible();
    await expect(page.locator(".repo-lane .project-drag-handle")).toHaveCount(0);
  });
});

test.describe("mobile repository ordering in Settings", () => {
  test.use({ viewport: { width: 320, height: 844 }, hasTouch: true });
  test("buttons, keyboard and touch save one order across mobile, reload and desktop", async ({ page, context }) => {
    const api = await fixture(page);
    api.longTitle();
    await page.goto("/");
    await connect(page);
    await openSettings(page, "Inställningar", true);
    const settings = page.locator('dialog[aria-labelledby="language-settings-title"]');
    const open = settings.getByRole("button", { name: "Ordna repositories", exact: true });
    await open.tap();
    const dialog = page.getByRole("dialog", { name: "Ordna repositories", exact: true });
    const rows = dialog.locator("li");
    await expect(rows.locator(".order-repository-name")).toHaveText(["sample/alpha", "sample/bravo", "sample/charlie"]);
    await expect(dialog.getByRole("button", { name: "Flytta alpha upp", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Flytta charlie-with-a-long-unbroken-repository-name ned", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Flytta bravo upp", exact: true }).tap();
    await expect(rows.first()).toHaveAttribute("data-repository", "sample/bravo");
    await expect(rows.first().locator(".project-drag-handle")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(rows.first()).toHaveAttribute("data-repository", "sample/alpha");
    await expect(rows.nth(1).locator(".project-drag-handle")).toBeFocused();
    await expect(dialog.getByRole("status")).toContainText("bravo flyttad till plats 2 av 3");
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await rows.first().evaluate(el => getComputedStyle(el).touchAction)).toBe("auto");
    expect(await rows.first().locator(".project-drag-handle").evaluate(el => getComputedStyle(el).touchAction)).toBe("none");
    const source = (await rows.nth(2).locator(".project-drag-handle").boundingBox())!;
    const target = (await rows.first().boundingBox())!;
    const client = await context.newCDPSession(page);
    const x = source.x + source.width / 2;
    const startY = source.y + source.height / 2;
    const endY = target.y + target.height / 2;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 10; step++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY + (endY - startY) * step / 10 }] });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(rows.first()).toHaveAttribute("data-repository", "sample/charlie");
    // The list scrolls normally when a gesture begins on its repository name.
    await page.setViewportSize({ width: 320, height: 360 });
    const list = dialog.locator(".repository-order-list");
    await expect.poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const bounds = (await list.boundingBox())!;
    const name = (await rows.first().locator(".order-repository-name").boundingBox())!;
    const scrollX = name.x + name.width / 2;
    const scrollY = bounds.y + bounds.height - 8;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: scrollX, y: scrollY }] });
    for (let step = 1; step <= 8; step++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: scrollX, y: scrollY - step * 8 }] });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.setViewportSize({ width: 320, height: 844 });
    await expect.poll(() => readSettings(page, "layout-alpha").then(saved => saved?.projectOrder?.slice(0, 3)))
      .toEqual(["sample/charlie", "sample/alpha", "sample/bravo"]);
    await page.keyboard.press("Escape");
    await expect(open).toBeFocused();
    await page.getByLabel("Språk", { exact: true }).selectOption("en");
    await settings.getByRole("button", { name: "Reorder repositories", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Reorder repositories", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await settings.getByRole("button", { name: "Done", exact: true }).click();
    await page.reload();
    await expectOrder(page, ["charlie-with-a-long-unbroken-repository-name", "alpha", "bravo"]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".sidebar-projects")).toBeVisible();
    await expectOrder(page, ["charlie-with-a-long-unbroken-repository-name", "alpha", "bravo"]);
  });
});
