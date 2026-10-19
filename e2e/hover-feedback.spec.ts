import { expect, test } from "@playwright/test";

// #196: left-menu items get hover and keyboard-focus feedback that differs from default and from the active item.
test("nav-item hover and focus differ from default and active", async ({ page }) => {
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "hover-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = [{
      id: 1, name: "alpha", full_name: "sample/alpha", private: false, description: "Fixture",
      html_url: "https://github.com/sample/alpha", owner: { login: "sample" },
    }];
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-hover-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: /^sample\/alpha/ }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  const items = page.locator(".nav-item");
  await expect(items.first()).toBeVisible();
  const style = (handle: ReturnType<typeof items.nth>) => handle.evaluate(el => {
    const s = getComputedStyle(el);
    return `${s.backgroundColor}|${s.boxShadow}`;
  });
  const active = items.locator("xpath=self::*[contains(@class,'active')]").first();
  const inactive = page.locator(".nav-item:not(.active)").first();
  await expect(inactive).toBeVisible();
  const before = await style(inactive);
  await inactive.hover();
  await page.waitForTimeout(300);
  const hovered = await style(inactive);
  expect(hovered).not.toBe(before);
  if (await active.count()) expect(hovered).not.toBe(await style(active));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.keyboard.press("Tab");
  await inactive.focus();
  await page.waitForTimeout(300);
  expect(await style(inactive)).not.toBe(before);
});
