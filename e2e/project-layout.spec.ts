import { expect, test, type Page } from "@playwright/test";

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
  await expect(sidebar.locator(".sidebar-repository-row > .project-order-controls:first-child")).toHaveCount(3);
  await expect(sidebar.locator(".project-order-controls button")).toHaveCount(3);
  const firstHandle = (await sidebar.locator(".project-drag-handle").first().boundingBox())!;
  const firstLink = (await sidebar.locator(".sidebar-repository").first().boundingBox())!;
  expect(firstHandle.x + firstHandle.width).toBeLessThanOrEqual(firstLink.x);
  expect(firstHandle.y).toBeLessThan(firstLink.y + firstLink.height);
  await sidebar.getByRole("button", { name: /^Ordna charlie med/ }).dragTo(sidebar.locator(".sidebar-repository-row").first());
  await expectOrder(page, ["charlie", "alpha", "bravo"]);
  const handle = sidebar.getByRole("button", { name: /^Ordna bravo med/ });
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expectOrder(page, ["charlie", "bravo", "alpha"]);
  await expect(handle).toBeFocused();
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
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("issueflow:layout-alpha")!).projectOrder.slice(0, 3)))
    .toEqual(["sample/charlie", "sample/bravo", "sample/alpha"]);
});


test.describe("touch sidebar ordering", () => {
  test.use({ viewport: { width: 1100, height: 900 }, hasTouch: true });
  test("a real touch drag reorders repositories and persists after reload", async ({ page, context }) => {
    await fixture(page);
    await page.goto("/");
    await connect(page);
    const rows = page.locator(".sidebar-repository-row");
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
    await page.getByRole("button", { name: "Inställningar", exact: true }).tap();
    await page.getByLabel("Språk", { exact: true }).selectOption("en");
    await page.getByRole("button", { name: "Done", exact: true }).tap();
    await page.reload();
    await expect(page.getByRole("button", { name: "Collapse bravo", exact: true })).toBeVisible();
    await expect(page.locator(".repo-lane .project-drag-handle")).toHaveCount(0);
  });
});
