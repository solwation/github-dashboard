import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const shots = process.env.SORT_SHOTS;
const devices = [
  { name: "1600x1000", width: 1600, height: 1000, mobile: false },
  { name: "1000x900", width: 1000, height: 900, mobile: false },
  { name: "390x844", width: 390, height: 844, mobile: true },
  { name: "844x390", width: 844, height: 390, mobile: true },
];
const firstNumber = (page: Page) => page.locator("#repo-1 .backlog").locator(".issue-card .issue-number, .issue-row .row-number").first().innerText().then(text => text.trim());

for (const device of devices) for (const list of [false, true]) {
  test(`column sort menu in ${list ? "List" : "Cards"} at ${device.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, isMobile: device.mobile, hasTouch: device.mobile, locale: "sv-SE" });
    const page = await context.newPage();
    await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
    if (list) await page.locator(".board-toolbar").getByRole("button", { name: "Lista", exact: true }).click();
    const lane = page.locator("#repo-1");
    const backlog = lane.locator(".board-column.backlog");
    const button = backlog.locator(".column-sort-button");
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeVisible();
    await expect(button).toHaveText("Högst prioritet först");
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    const before = await firstNumber(page);

    // Pointer or touch opens the menu; the active option is marked.
    if (device.mobile) await button.tap(); else await button.click();
    const menu = backlog.getByRole("menu", { name: "Sortering" });
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
    await expect(menu.getByRole("menuitemradio", { name: "Högst prioritet först" })).toHaveAttribute("aria-checked", "true");
    if (shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: `${shots}/sort-${list ? "list" : "cards"}-${device.name}.png` }); }
    // Geometry: inside the viewport, not wider than it and below the column header text.
    const box = (await menu.boundingBox())!, trigger = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(device.width + 0.5);
    expect(box.y).toBeGreaterThanOrEqual(trigger.y + trigger.height - 1);
    const heading = (await backlog.locator(".column-heading").boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(heading.y + heading.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (device.mobile) for (const item of await menu.getByRole("menuitemradio").all()) expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Choose a different order; the last issue comes first and the hint shows it.
    const choice = menu.getByRole("menuitemradio", { name: "Lägst prioritet först" });
    if (device.mobile) await choice.tap(); else await choice.click();
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveText("Lägst prioritet först");
    expect(await firstNumber(page)).not.toBe(before);
    // Persisted: survives a reload, and picking the default resets.
    await page.reload(); await page.getByRole("button", { name: "Utforska en demo" }).click();
    await expect(page.locator("#repo-1 .board-column.backlog .column-sort-button")).toHaveText("Lägst prioritet först");
    await page.locator("#repo-1 .board-column.backlog .column-sort-button").click();
    await page.getByRole("menuitemradio", { name: "Högst prioritet först" }).first().click();
    expect(await firstNumber(page)).toBe(before);
    await context.close();
  });
}

test("keyboard opens, navigates and Escape returns focus; the choice applies to the combined board", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const closed = page.locator("#repo-1 .board-column.closed .column-sort-button");
  await expect(closed).toHaveText("Senaste 30 dagarna · nyast först");
  await closed.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Sortering" });
  await expect(menu.getByRole("menuitemradio", { name: "Nyast stängd först" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "Äldst stängd först" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu.getByRole("menuitemradio", { name: "Prioritet" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemradio", { name: "Nyast stängd först" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(closed).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(closed).toHaveText("Äldst stängd först");
  await expect(closed).toBeFocused();
  // The choice is global per column: the combined board shows the same order.
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  await expect(page.locator(".combined-board .board-column.closed .column-sort-button")).toHaveText("Äldst stängd först");
  await expect(page.locator(".combined-board .board-column.backlog .column-sort-button")).toHaveText("Högst prioritet först");
});
