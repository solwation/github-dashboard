import { expect, test } from "@playwright/test";

test("repository settings stay at the right end of one compact action row", async ({ page }) => {
  const name = "a-repository-with-a-long-project-name";
  const repo = { id: 1, name, full_name: `sample/${name}`, private: true, description: "A detailed description of a project", html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } };
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: url.pathname === "/user" ? { login: "header-test", avatar_url: "" }
      : url.pathname === "/user/repos" ? [repo] : url.pathname === `/repos/${repo.full_name}` ? repo : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-header-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: repo.full_name }).check();
  await page.getByRole("button", { name: "Visa översikt", exact: true }).click();
  const header = page.locator(".lane-header");
  const settings = header.getByRole("button", { name: `Anpassa labels för ${name}` });
  const notification = header.getByRole("switch");
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(settings).toBeVisible();
    const boxes = await Promise.all([header, settings, notification].map(locator => locator.boundingBox()));
    const [headerBox, settingsBox, notificationBox] = boxes.map(box => box!);
    expect(Math.abs(settingsBox.y + settingsBox.height / 2 - notificationBox.y - notificationBox.height / 2)).toBeLessThan(2);
    expect(settingsBox.x).toBeGreaterThan(notificationBox.x + notificationBox.width);
    expect(headerBox.x + headerBox.width - settingsBox.x - settingsBox.width).toBeLessThan(25);
    expect(headerBox.height).toBeLessThan(width > 650 ? 110 : 160);
    expect(headerBox.x + headerBox.width).toBeLessThanOrEqual(width);
    expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth), `header width ${width}`).toBe(true);
    if (width === 1280) await page.screenshot({ path: "/tmp/issueflow-repository-header-desktop.png" });
  }
  await page.screenshot({ path: "/tmp/issueflow-repository-header-mobile.png", fullPage: false });
  await header.getByRole("button", { name: `Kollapsa ${name}` }).click();
  await expect(header.locator(".lane-summary")).toBeVisible();
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page.getByRole("dialog", { name: "Anpassa labels" })).toBeVisible();
});
