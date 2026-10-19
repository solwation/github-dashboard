import { expect, test } from "@playwright/test";

// #195: bug and enhancement issues get different icon, class and accessible title.
test("issue cards show a type icon derived from labels", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const bug = page.locator(".repo-lane .issue-card", { has: page.locator(".type-circle.type-bug") }).first();
  const feature = page.locator(".repo-lane .issue-card", { has: page.locator(".type-circle.type-feature") }).first();
  await expect(bug.locator(".type-circle.type-bug")).toHaveAttribute("title", "Typ: Bugg");
  await expect(feature.locator(".type-circle.type-feature")).toHaveAttribute("title", "Typ: Funktion");
  const [a, b] = await Promise.all([bug.locator(".type-circle svg").first().getAttribute("class"), feature.locator(".type-circle svg").first().getAttribute("class")]);
  expect(a).not.toBe(b);
  const [ca, cb] = await Promise.all([bug.locator(".type-circle").evaluate(e => getComputedStyle(e).backgroundColor), feature.locator(".type-circle").evaluate(e => getComputedStyle(e).backgroundColor)]);
  expect(ca).not.toBe(cb);
  const closed = page.locator(".repo-lane .issue-card.closed .type-circle").first();
  await expect(closed.locator(".type-closed")).toHaveCount(1);
  await expect(closed).toHaveAttribute("title", /Stängd/);
  expect((await bug.locator(".issue-number").boundingBox())!.height).toBeLessThan(20);
});

// #197: the label the icon was derived from is not repeated as a chip; other labels still render.
test("cards hide the label the type icon stands for", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const board = page.locator(".repo-lane");
  await expect(board.locator(".issue-card .type-circle.type-bug").first()).toBeVisible();
  const bugs = board.locator(".issue-card", { has: page.locator(".type-circle.type-bug") });
  const features = board.locator(".issue-card", { has: page.locator(".type-circle.type-feature") });
  await expect(bugs.locator('.label[title="bug" i]')).toHaveCount(0);
  await expect(features.locator('.label[title="enhancement" i]')).toHaveCount(0);
  await expect(board.locator(".issue-card .label").first()).toBeVisible();
  const withOther = board.locator(".issue-card", { has: page.locator(".type-circle") }).filter({ has: page.locator(".label") }).first();
  await expect(withOther.locator(".label")).not.toHaveCount(0);
  await expect(withOther.locator(".type-circle")).toHaveAttribute("title", /Typ: /);
});

// #198: the in-progress label is redundant inside the In progress column; other columns are untouched.
test("cards hide the in-progress label in the In progress column", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const inProgress = page.locator(".repo-lane .issue-card.progress");
  await expect(inProgress.first()).toBeVisible();
  await expect(inProgress.locator('.label[title="in-progress" i]')).toHaveCount(0);
  await expect(page.locator('.repo-lane .issue-card:not(.progress) .label[title="design"]').first()).toBeVisible();
});
