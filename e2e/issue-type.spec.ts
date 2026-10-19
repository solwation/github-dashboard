import { expect, test } from "@playwright/test";

// #195: bug and enhancement issues get different icon, class and accessible title.
test("issue cards show a type icon derived from labels", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Utforska en demo" }).click();
  const bug = page.locator(".repo-lane .issue-card", { has: page.locator('.label[title="bug"]') }).first();
  const feature = page.locator(".repo-lane .issue-card", { has: page.locator('.label[title="enhancement"]') }).first();
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
