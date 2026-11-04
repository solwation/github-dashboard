import { expect, test, type Page } from "@playwright/test";
import { readSettings } from "./support/settings";
import { openSettings } from "./support/phone-menu";

const repo = (full_name: string, id: number, extra: Record<string, unknown> = {}) => ({
  id, name: full_name.split("/")[1], full_name, private: false, description: "Fictional fixture",
  html_url: `https://github.com/${full_name}`, owner: { login: full_name.split("/")[0] }, ...extra,
});
const own = [repo("sample/alpha", 1), repo("sample/beta", 2)];
const external: Record<string, unknown> = {
  "octo/hello": repo("octo/hello", 11), "octo/world": repo("octo/world", 12), "octo/secret": repo("octo/secret", 13, { private: true }),
};

async function mock(page: Page) {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    const date = new Date().toISOString();
    if (url.pathname === "/user") return route.fulfill({ json: { login: "external-user", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: own });
    const direct = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)$/);
    if (direct) {
      const found = external[direct[1]!] ?? own.find(entry => entry.full_name === direct[1]);
      return found ? route.fulfill({ json: found }) : route.fulfill({ status: 404, json: { message: "Not Found" } });
    }
    if (url.pathname.endsWith("/issues")) {
      const open = url.searchParams.get("state") !== "closed";
      const alpha = url.pathname.includes("sample/alpha") || url.pathname.includes("octo/");
      return route.fulfill({ json: open && alpha ? [{ id: 5, number: 1, title: "Fixture task", state: "open", labels: [], assignees: [], comments: 0, created_at: date, updated_at: date, closed_at: null, html_url: "https://github.com/x/y/issues/1" }] : [] });
    }
    return route.fulfill({ json: [] });
  });
}
const group = (page: Page) => page.locator(".sidebar-external-group");
const names = (page: Page) => group(page).locator(".repository-label");

test("other people's public repositories form their own ordered, removable, encrypted group", async ({ page }) => {
  await mock(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-external-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Välj repositories" });
  await picker.getByRole("checkbox", { name: /sample\/alpha/ }).check();
  await picker.getByRole("checkbox", { name: /sample\/beta/ }).check();

  // From the + menu: errors do not add anything.
  const input = picker.getByLabel("Lägg till någon annans publika repository");
  const submit = picker.getByRole("button", { name: "Lägg till repository", exact: true });
  for (const [value, message] of [["octo/missing", /404|Not Found/], ["octo/secret", /Endast publika/], ["sample/alpha", /redan bland dina egna/], ["inte en adress", /Ange ägare\/repo/]] as const) {
    await input.fill(value); await submit.click();
    await expect(picker.getByRole("alert")).toContainText(message);
  }
  await expect(picker.getByRole("heading", { name: "Andras publika projekt" })).toHaveCount(0);
  await input.fill("octo/hello"); await submit.click();
  await expect(picker.getByRole("heading", { name: "Andras publika projekt" })).toBeVisible();
  await expect(picker.getByRole("checkbox", { name: /octo\/hello/ })).toBeChecked();
  await picker.getByRole("button", { name: "Visa översikt" }).click();

  // Below the inactive toggle, own group untouched.
  await expect(names(page)).toHaveText(["hello"]);
  const toggle = page.locator(".sidebar-inactive-toggle");
  const own1 = page.locator(".sidebar-repository-row[data-repository='sample/alpha']");
  await expect(own1).toBeVisible();
  const heading = group(page).getByRole("heading", { name: "Andras publika projekt" });
  expect((await heading.boundingBox())!.y).toBeGreaterThan((await own1.boundingBox())!.y);
  if (await toggle.count()) expect((await heading.boundingBox())!.y).toBeGreaterThan((await toggle.boundingBox())!.y);

  // From Settings: add, reorder within the group, remove.
  await openSettings(page);
  await page.getByRole("button", { name: "Ordna repositories", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ordna repositories" });
  await dialog.getByLabel("Lägg till någon annans publika repository").fill("octo/world");
  await dialog.getByRole("button", { name: "Lägg till repository", exact: true }).click();
  await expect(dialog.locator("li[data-repository^='octo/']")).toHaveCount(2);
  await dialog.getByLabel("Lägg till någon annans publika repository").fill("octo/hello");
  await dialog.getByRole("button", { name: "Lägg till repository", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("redan tillagt");
  await expect(dialog.getByRole("heading", { name: "Andras publika projekt" })).toBeVisible();
  // Own projects come first; moves stop at the group boundary.
  await expect.poll(() => dialog.locator("li[data-repository]").evaluateAll(items => items.map(item => item.getAttribute("data-repository")))).toEqual(["sample/alpha", "sample/beta", "octo/hello", "octo/world"]);
  await expect(dialog.getByRole("button", { name: "Flytta hello upp" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Flytta beta ned" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Flytta world upp" }).click();
  await expect.poll(() => dialog.locator("li[data-repository]").evaluateAll(items => items.map(item => item.getAttribute("data-repository")))).toEqual(["sample/alpha", "sample/beta", "octo/world", "octo/hello"]);
  await expect(names(page)).toHaveText(["world", "hello"]);
  await expect.poll(() => readSettings(page, "external-user").then(saved => saved?.externalRepositories?.map((entry: { full_name: string }) => entry.full_name))).toEqual(["octo/world", "octo/hello"]);
  await expect.poll(() => readSettings(page, "external-user").then(saved => saved?.projectOrder?.includes("octo/world"))).not.toBe(true);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes("octo"))).toBe(false);
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(names(page)).toHaveText(["world", "hello"]);

  await openSettings(page);
  await page.getByRole("button", { name: "Ordna repositories", exact: true }).click();
  await dialog.getByRole("button", { name: "Ta bort world" }).click();
  await expect(names(page)).toHaveText(["hello"]);
  await dialog.getByRole("button", { name: "Ta bort hello" }).click();
  await expect(group(page)).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "Andras publika projekt" })).toHaveCount(0);
  await expect.poll(() => readSettings(page, "external-user").then(saved => saved?.externalRepositories)).toEqual([]);
});

test("external projects discover img artwork and retain it across encrypted reload", async ({ page }, info) => {
 await mock(page);
 const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#147d69"/><path d="M32 8L50 48H14Z" fill="white"/></svg>';
 let reads = 0;
 await page.route("https://api.github.com/repos/octo/hello/contents**", async route => {
  reads++; const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/contents")) return route.fulfill({ json: [{ name: "img", path: "img", type: "dir", size: 0 }] });
  if (path.endsWith("/contents/img")) return route.fulfill({ json: [{ name: "favicon.svg", path: "img/favicon.svg", type: "file", size: svg.length }] });
  return route.fulfill({ json: { name: "favicon.svg", path: "img/favicon.svg", type: "file", size: svg.length, encoding: "base64", content: Buffer.from(svg).toString("base64") } });
 });
 await page.goto("/"); await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click(); await page.getByLabel("GitHub personal access token").fill("fictional-external-icon-token"); await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
 const picker = page.getByRole("dialog", { name: "Välj repositories" });
 await picker.getByLabel("Lägg till någon annans publika repository").fill("octo/hello"); await picker.getByRole("button", { name: "Lägg till repository", exact: true }).click(); await expect(picker.getByRole("checkbox", { name: /octo\/hello/ })).toBeChecked(); await picker.getByRole("button", { name: "Visa översikt" }).click();
 const icon = group(page).locator('.project-icon[data-repository="octo/hello"] img'); await expect(icon).toHaveAttribute("src", /^data:image\/png;base64,/); expect(reads).toBe(3);
 await expect.poll(() => page.evaluate(async () => { const path = "/src/lib/content-cache.ts"; const { readSnapshot } = await import(path); return (await readSnapshot("fictional-external-icon-token"))?.repos.find((repo: any) => repo.full_name === "octo/hello")?.projectIcon?.data; })).toMatch(/^data:image\/png;base64,/);
 await page.reload(); await expect(icon).toHaveAttribute("src", /^data:image\/png;base64,/); await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false"); expect(reads).toBe(3);
 await page.screenshot({ path: info.outputPath("external-img-icon.png") });
});
