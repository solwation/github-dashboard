import { expect, test } from "@playwright/test";

// #192: circle + id, optional repo chip and labels share one top row.
test("card top row orders id, repo chip and labels; chip only when not split", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".repo-lane .issue-card").first()).toBeVisible();
  await expect(page.locator(".card-repository")).toHaveCount(0);
  const labeled = page.locator(".repo-lane .issue-card", { has: page.locator(".label") }).first();
  const [number, label, title] = await Promise.all([
    labeled.locator(".issue-number").boundingBox(), labeled.locator(".label").first().boundingBox(), labeled.locator(".issue-title").boundingBox(),
  ]);
  expect(Math.abs(number!.y + number!.height / 2 - (label!.y + label!.height / 2))).toBeLessThan(8);
  expect(label!.x).toBeGreaterThan(number!.x + number!.width - 1);
  expect(title!.y).toBeGreaterThan(label!.y + label!.height - 1);

  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  const board = page.locator(".combined-board");
  const card = board.locator(".issue-card", { has: page.locator(".label") }).first();
  await expect(card).toBeVisible();
  const chip = card.locator(".card-repository");
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText("/");
  const [n, c, l] = await Promise.all([card.locator(".issue-number").boundingBox(), chip.boundingBox(), card.locator(".label").first().boundingBox()]);
  expect(Math.abs(n!.y - c!.y)).toBeLessThan(10);
  expect(c!.x).toBeGreaterThan(n!.x);
  expect(l!.y > c!.y + c!.height - 1 || l!.x > c!.x + c!.width - 1).toBe(true);
  expect(await card.locator(".issue-number, .card-repository, .label").evaluateAll(els => els.map(e => e.className.split(" ")[0]).slice(0, 3))).toEqual(["issue-number", "card-repository", "label"]);

  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).check();
  await expect(page.locator(".card-repository")).toHaveCount(0);
});
