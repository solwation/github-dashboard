import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import { closePhoneMenu, openSettings } from "./support/phone-menu";

// Fictional fixtures: an active public and private repository, an inactive one and another person's public project.
const repo = (full_name: string, id: number, extra: Record<string, unknown> = {}) => ({
  id, name: full_name.split("/")[1], full_name, private: false, description: "Fictional fixture",
  html_url: `https://github.com/${full_name}`, owner: { login: full_name.split("/")[0] }, ...extra,
});
const own = [repo("sample/alpha", 1), repo("sample/beta", 2, { private: true }), repo("sample/quiet", 3)];
const external = repo("octo/hello", 11);
const evidence = process.env.ISSUE_367_EVIDENCE;

async function mock(page: Page, login: string) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const date = new Date(Date.now() - 3_600_000).toISOString();
    if (url.pathname === "/user") return route.fulfill({ json: { login, avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: own });
    if (url.pathname === "/repos/octo/hello") return route.fulfill({ json: external });
    const issues = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
    if (issues) {
      const name = issues[1]!, closed = url.searchParams.get("state") === "closed", number = name === "sample/quiet" ? 3 : name.length;
      if (closed !== (name === "sample/quiet")) return route.fulfill({ json: [] });
      const title = `${name.split("/")[1]} ${closed ? "finished" : "open"} task with a fairly long title for wrapping`;
      return route.fulfill({ json: [{ id: number * 100 + name.charCodeAt(0), number, title, body: "", state: closed ? "closed" : "open", closed_at: closed ? date : null,
        labels: [{ name: "enhancement", color: "a2eeef" }], assignees: [], comments: 0, created_at: date, updated_at: date, html_url: `https://github.com/${name}/issues/${number}` }] });
    }
    return route.fulfill({ json: [] });
  });
}

async function connect(page: Page, login: string) {
  await mock(page, login);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill(`fictional-${login}-token`);
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Välj repositories" });
  for (const entry of own) await picker.getByRole("checkbox", { name: new RegExp(entry.full_name) }).check();
  await picker.getByLabel("Lägg till någon annans publika repository").fill("octo/hello");
  await picker.getByRole("button", { name: "Lägg till repository", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: /octo\/hello/ })).toBeChecked();
  await picker.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
}

const stat = (page: Page, key: string) => page.locator(`.stats [data-stat="${key}"] strong`);
const row = (page: Page, name: string) => page.locator(`.sidebar-repository-row[data-repository="${name}"]`);
const boardRepositories = (page: Page) => page.evaluate(() => {
  const items = [...document.querySelectorAll<HTMLElement>(".combined-board [data-repository], .repo-lane [data-repository]")].map(item => item.dataset.repository!);
  return { lanes: document.querySelectorAll(".repo-lane").length, items: [...new Set(items)].sort() };
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });
  test("hides projects from the board while the left menu keeps them greyed, in split and combined views (#367)", async ({ page }) => {
    await connect(page, "board-visibility");
    // Hide inactive repositories is off by default; turned on, quiet stays in the menu, greyed and off the board.
    await expect(page.locator("#repo-3")).toBeVisible();
    await expect(stat(page, "open")).toHaveText(/^3/);
    await expect(stat(page, "closed")).toHaveText(/^1/);
    await page.getByRole("checkbox", { name: "Dölj inaktiva repositories" }).check();
    await expect(row(page, "sample/quiet")).toHaveClass(/repository-hidden/);
    await expect(page.locator("#repo-3")).toHaveCount(0);
    // Overview totals follow the board (#371); the Repositories card still counts every selected project.
    await expect(stat(page, "closed")).toHaveText(/^0/);
    await expect(stat(page, "repositories")).toHaveText("4");
    await expect(page.locator("#repo-1, #repo-2, #repo-11")).toHaveCount(3);

    // Hover reveals Hide; it is not shown on an untouched row.
    const alphaHide = row(page, "sample/alpha").getByRole("button", { name: "Dölj alpha i innehållsvyn" });
    await page.mouse.move(1500, 900);
    await expect(alphaHide).toHaveCSS("opacity", "0");
    await row(page, "sample/alpha").hover();
    await expect(alphaHide).toHaveCSS("opacity", "1");
    if (evidence) await page.locator(".sidebar-projects").screenshot({ path: `${evidence}/sidebar-hover-hide.png` });
    await alphaHide.click();
    await expect(row(page, "sample/alpha")).toHaveClass(/repository-hidden/);
    await expect(page.locator("#repo-1")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "alpha dold i innehållsvyn" })).toHaveCount(1);
    await expect(stat(page, "open")).toHaveText(/^2/);
    await expect(page.locator(".stats .stat-delta")).toHaveCount(0);

    // Keyboard: the action follows the row link (and Pages) in tab order, for another person's public project.
    await row(page, "octo/hello").locator(".sidebar-repository").focus();
    await page.keyboard.press("Tab");
    const helloAction = row(page, "octo/hello").locator(".repo-board-toggle");
    await expect(helloAction).toBeFocused();
    await expect(helloAction).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    await expect(helloAction).toHaveAccessibleName("Visa hello i innehållsvyn");
    await expect(helloAction).toBeFocused();
    await expect(page.locator("#repo-11")).toHaveCount(0);
    // Hidden rows always show their Show action and carry the state in their accessible text.
    await page.mouse.move(1500, 900);
    await expect(helloAction).toHaveCSS("opacity", "1");
    await expect(row(page, "octo/hello").locator(".sidebar-repository")).toContainText("Dold i innehållsvyn");

    // Private project via the same action; the board is left with nothing to show.
    await row(page, "sample/beta").hover();
    await row(page, "sample/beta").getByRole("button", { name: "Dölj beta i innehållsvyn" }).click();
    await expect(page.locator(".repo-lane")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Alla repositories är dolda" })).toBeVisible();

    // Combined view: no empty sections, and only shown projects contribute cards.
    await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
    await expect(page.locator(".combined-board")).toHaveCount(0);
    await row(page, "sample/beta").getByRole("button", { name: "Visa beta i innehållsvyn" }).click();
    await expect(page.locator(".combined-board")).toBeVisible();
    expect((await boardRepositories(page)).items).toEqual(["sample/beta"]);

    // Clicking an automatically hidden inactive project shows and selects it while the setting stays on.
    await row(page, "sample/quiet").locator(".sidebar-repository").click();
    await expect(row(page, "sample/quiet")).not.toHaveClass(/repository-hidden/);
    await expect(row(page, "sample/quiet").locator(".sidebar-repository")).toHaveClass(/repository-selected/);
    await expect(page.getByRole("checkbox", { name: "Dölj inaktiva repositories" })).toBeChecked();
    await expect.poll(async () => (await boardRepositories(page)).items).toEqual(["sample/beta", "sample/quiet"]);
    if (evidence) await page.screenshot({ path: `${evidence}/combined-desktop-1600.png` });

    // Manual choices are encrypted per account; reveals last for the session only.
    await expect.poll(() => readSettings(page, "board-visibility").then(saved => saved?.hiddenRepos)).toEqual(["sample/alpha", "octo/hello"]);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes("octo/hello"))).toBe(false);
    await page.reload();
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    await expect(row(page, "sample/alpha")).toHaveClass(/repository-hidden/);
    await expect(row(page, "octo/hello")).toHaveClass(/repository-hidden/);
    await expect(row(page, "sample/quiet")).toHaveClass(/repository-hidden/);
    await expect(row(page, "sample/beta")).not.toHaveClass(/repository-hidden/);
    expect((await boardRepositories(page)).items).toEqual(["sample/beta"]);

    // Turning automatic hiding off keeps manual choices; turning it on again hides quiet again.
    const hideInactive = page.getByRole("checkbox", { name: "Dölj inaktiva repositories" });
    await hideInactive.uncheck();
    await expect.poll(async () => (await boardRepositories(page)).items).toEqual(["sample/beta", "sample/quiet"]);
    await expect(row(page, "sample/alpha")).toHaveClass(/repository-hidden/);
    await hideInactive.check();
    await expect.poll(async () => (await boardRepositories(page)).items).toEqual(["sample/beta"]);

    // Split view: clicking a manually hidden project shows it again, expanded.
    await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).check();
    await page.getByRole("button", { name: "Kollapsa beta" }).click();
    await row(page, "sample/alpha").locator(".sidebar-repository").click();
    await expect(page.locator("#repo-1")).toBeVisible();
    await expect(page.locator("#repo-1 .swimlane")).toBeVisible();
    await expect(row(page, "sample/alpha")).not.toHaveClass(/repository-hidden/);
    await expect.poll(() => readSettings(page, "board-visibility").then(saved => saved?.hiddenRepos)).toEqual(["octo/hello"]);
    // Collapsing stays separate from hiding: beta remains a collapsed section on the board.
    await expect(page.locator("#repo-2")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (evidence) await page.screenshot({ path: `${evidence}/split-desktop-1600.png` });
  });
});

test.describe("touch tablet", () => {
  test.use({ viewport: { width: 1000, height: 900 }, isMobile: true, hasTouch: true });
  test("hides from Settings and shows again by tapping the greyed row, without hover (#367)", async ({ page }) => {
    await connect(page, "board-visibility-touch");
    // No third 44px target fits beside a touch row's name; the sidebar keeps names readable.
    await expect(row(page, "sample/alpha").locator(".repo-board-toggle")).toBeHidden();
    await openSettings(page, "Inställningar", true);
    await page.getByRole("button", { name: "Ordna repositories", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Ordna repositories" });
    const hide = dialog.getByRole("button", { name: "Dölj alpha i innehållsvyn" });
    const box = (await hide.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await hide.tap();
    await dialog.getByRole("button", { name: "Klart" }).tap();
    await page.keyboard.press("Escape");
    await expect(page.locator("#repo-1")).toHaveCount(0);
    await expect(row(page, "sample/alpha")).toHaveClass(/repository-hidden/);
    if (evidence) await page.screenshot({ path: `${evidence}/touch-tablet-1000.png` });
    await row(page, "sample/alpha").locator(".sidebar-repository").tap();
    await expect(page.locator("#repo-1")).toBeVisible();
    await expect(row(page, "sample/alpha")).not.toHaveClass(/repository-hidden/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("hides and shows projects from Settings where the left menu is not shown (#367)", async ({ page }) => {
    await connect(page, "board-visibility-phone");
    await expect(page.locator(".sidebar-projects")).toBeHidden();
    await openSettings(page, "Inställningar", true);
    await page.getByRole("button", { name: "Ordna repositories", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Ordna repositories" });
    await expect(dialog.getByRole("checkbox", { name: "Dölj inaktiva repositories" })).not.toBeChecked();
    await expect(dialog.locator("li[data-repository='sample/quiet']")).not.toContainText("Dold i innehållsvyn");
    await dialog.getByRole("checkbox", { name: "Dölj inaktiva repositories" }).tap();
    await expect(dialog.locator("li[data-repository='sample/quiet']")).toContainText("Dold i innehållsvyn");
    const hide = dialog.getByRole("button", { name: "Dölj hello i innehållsvyn" });
    expect((await hide.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await hide.tap();
    await dialog.getByRole("button", { name: "Visa quiet i innehållsvyn" }).tap();
    if (evidence) await dialog.screenshot({ path: `${evidence}/phone-order-dialog-390.png` });
    await dialog.getByRole("button", { name: "Klart" }).tap();
    await page.keyboard.press("Escape");
    await closePhoneMenu(page);
    await expect(page.locator("#repo-11")).toHaveCount(0);
    await expect(page.locator("#repo-3")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (evidence) await page.screenshot({ path: `${evidence}/phone-split-390.png` });
  });
});
