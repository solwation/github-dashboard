import { expect, test, type Locator, type Page } from "@playwright/test";
import { encodeHandoff } from "../src/lib/handoff";
import { readSettings } from "./support/settings";
import { connectGrouping, groupingFixture, groupingOption, setBoardGrouping } from "./support/board-grouping";

const box = async (locator: Locator) => (await locator.boundingBox())!;
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("None, Split and Swimlanes keep counts, filters and the choice across Cards/List, reloads and transfers (#390)", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const repos = await groupingFixture(page, 3);
  await connectGrouping(page, repos);
  await expect(groupingOption(page, "split")).toHaveAttribute("aria-pressed", "true");

  // Keyboard operable like the Cards/List switch.
  await groupingOption(page, "swimlanes").focus(); await page.keyboard.press("Enter");
  const board = page.locator(".swimlane-board");
  const bands = board.locator(".swimlane-band");
  await expect(bands).toHaveCount(3);
  await expect(page.locator(".repo-lane, .combined-board")).toHaveCount(0);
  // One shared status header with the combined totals; lanes follow the sidebar order.
  const head = board.locator(".swimlane-board-head");
  await expect(head.locator(".column-count")).toHaveText(["6", "2", "3"]);
  for (const [index, repo] of repos.entries()) {
    const band = page.locator(`#repo-${repo.id}`);
    await expect(band.locator(".issue-card")).toHaveCount(index === 2 ? 3 : 4);
    await expect(band.locator(`.issue-card:not([data-repository="${repo.full_name}"])`)).toHaveCount(0);
  }
  // An empty status group keeps its cell with a compact empty state.
  await expect(page.locator(`#board-${repos[2]!.id}-progress .column-empty`)).toBeVisible();
  // Cards: lanes are horizontal bands stacked vertically, each spanning the status columns.
  const [first, second] = [await box(bands.nth(0)), await box(bands.nth(1))];
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
  expect(Math.abs(first.width - second.width)).toBeLessThanOrEqual(1);
  const cells = await Promise.all(["backlog", "progress", "closed"].map(key => box(page.locator(`#board-${repos[0]!.id}-${key}`))));
  expect(cells[1]!.x).toBeGreaterThan(cells[0]!.x); expect(cells[2]!.x).toBeGreaterThan(cells[1]!.x);
  expect(Math.abs(cells[0]!.y - cells[2]!.y)).toBeLessThanOrEqual(1);
  const headCells = head.locator(".board-column");
  expect(Math.abs((await box(headCells.nth(1))).x - cells[1]!.x)).toBeLessThanOrEqual(1);

  // The main search filters every mode the same way.
  const search = page.getByRole("textbox", { name: "Sök issues", exact: true });
  await search.fill("alpha");
  await expect(head.locator(".column-count")).toHaveText(["2", "1", "1"]);
  await expect(board.locator(".issue-card")).toHaveCount(4);
  await expect(page.locator(`#board-${repos[2]!.id}-backlog .column-empty`)).toContainText("Inga issues matchar filtren");
  await setBoardGrouping(page, "none");
  await expect(page.locator(".combined-board .column-count")).toHaveText(["2", "1", "1"]);
  await setBoardGrouping(page, "split");
  await expect(page.locator(`#repo-${repos[0]!.id} .issue-card`)).toHaveCount(4);
  await search.fill("");

  // Switching Cards/List keeps the grouping; List lanes are vertical columns side by side.
  await setBoardGrouping(page, "swimlanes");
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(groupingOption(page, "swimlanes")).toHaveAttribute("aria-pressed", "true");
  await expect(board).toHaveClass(/list-mode/);
  await expect(board.locator(".swimlane-board-head")).toHaveCount(0);
  await expect(board.locator(".issue-row")).toHaveCount(11);
  const [left, right] = [await box(bands.nth(0)), await box(bands.nth(1))];
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1);
  expect(Math.abs(left.y - right.y)).toBeLessThanOrEqual(1);
  const groups = await Promise.all(["backlog", "progress", "closed"].map(key => box(page.locator(`#board-${repos[0]!.id}-${key}`))));
  expect(groups[1]!.y).toBeGreaterThan(groups[0]!.y); expect(Math.abs(groups[0]!.x - groups[1]!.x)).toBeLessThanOrEqual(1);
  expect(await noPageOverflow(page)).toBe(true);
  await page.getByRole("button", { name: "Kort", exact: true }).click();
  await expect(groupingOption(page, "swimlanes")).toHaveAttribute("aria-pressed", "true");

  // Sidebar activation reveals the lane, and a second activation collapses it like a split board.
  const sidebar = page.locator(`.sidebar-repository-row[data-repository="${repos[1]!.full_name}"] .sidebar-repository`);
  await sidebar.click();
  await expect(page.locator(`#repo-${repos[1]!.id}`)).toHaveClass(/repository-navigation-highlight/);
  await sidebar.click();
  await expect(page.locator(`#repo-${repos[1]!.id}`)).toHaveClass(/is-collapsed/);
  await expect(page.locator(`#repo-${repos[1]!.id} .swimlane-counts`)).toContainText("Backlog: 2");
  await page.locator(`#repo-${repos[1]!.id}`).getByRole("button", { name: `Expandera ${repos[1]!.name}`, exact: true }).click();

  // Saved encrypted per account, with the legacy boolean kept in step for older readers.
  await expect.poll(() => readSettings(page, "grouping-fixture").then(saved => saved?.preferences)).toMatchObject({ boardGrouping: "swimlanes", splitByRepository: false });
  await page.reload();
  await expect(bands).toHaveCount(3);
  await expect(groupingOption(page, "swimlanes")).toHaveAttribute("aria-pressed", "true");

  // Older transfers carry only the boolean: true stays Split and false stays None.
  const selected = repos.map(repo => repo.full_name);
  for (const [splitByRepository, grouping, locator] of [[false, "none", ".combined-board"], [true, "split", ".repo-lane"]] as const) {
    await page.goto("about:blank");
    await page.goto("/#issueflow-handoff=" + encodeHandoff({ token: "fictional-grouping-token", selected, rules: {}, preferences: { splitByRepository } }));
    await expect(groupingOption(page, grouping)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(locator).first()).toBeVisible();
    await expect.poll(() => readSettings(page, "grouping-fixture").then(saved => saved?.preferences?.boardGrouping)).toBe(grouping);
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
  test.describe(`touch ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });
    test("swimlanes stack without page overflow and keep 44px grouping targets", async ({ page }) => {
      const repos = await groupingFixture(page, 4);
      await page.setViewportSize({ width: 1200, height: 900 });
      await connectGrouping(page, repos);
      await page.setViewportSize(viewport);
      await setBoardGrouping(page, "swimlanes");
      for (const button of await page.getByRole("group", { name: "Gruppering per repository", exact: true }).getByRole("button").all()) {
        expect((await box(button)).height).toBeGreaterThanOrEqual(44);
      }
      for (const mode of ["Kort", "Lista"]) {
        await page.getByRole("button", { name: mode, exact: true }).click();
        const bands = page.locator(".swimlane-band");
        await expect(bands).toHaveCount(4);
        await expect(page.locator(".swimlane-board-head")).toBeHidden();
        await expect(page.locator(`#board-${repos[0]!.id}-backlog .column-header`)).toBeVisible();
        const [first, second] = [await box(bands.nth(0)), await box(bands.nth(1))];
        expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
        expect(await noPageOverflow(page)).toBe(true);
      }
    });
  });
}
