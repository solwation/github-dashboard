import { expect, test } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

test("repository settings stay at the right end of one compact action row", async ({ page }) => {
  const name = "a-repository-with-a-long-project-name";
  await page.addInitScript(() => {
    class NotificationStub {
      static permission = "granted";
      static async requestPermission() { return "granted"; }
      close() {}
    }
    Object.assign(window, { Notification: NotificationStub });
  });
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
  const settings = header.getByRole("button", { name: `Repositoryegenskaper för ${name}` });
  await expect(header.getByRole("switch")).toHaveCount(0);
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(settings).toBeVisible();
    const boxes = await Promise.all([header, settings].map(locator => locator.boundingBox()));
    const [headerBox, settingsBox] = boxes.map(box => box!);
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
  await settings.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Repositoryegenskaper", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Pågående arbete", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Notifikationsljud", { exact: true })).toHaveCount(0);
  const subscription = dialog.getByRole("switch", { name: `Notiser för ${name}`, exact: true });
  await subscription.focus(); await page.keyboard.press("Space");
  await expect(subscription).toBeChecked();
  await expect(dialog.locator(".notification-notice")).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
  await page.getByRole("checkbox", { name: "Dela upp per repository", exact: true }).uncheck();
  await page.getByText("Repositoryinställningar", { exact: true }).click();
  const controls = page.locator(".combined-repository-controls");
  await expect(controls.getByRole("switch")).toHaveCount(0);
  await controls.getByRole("button", { name: `Repositoryegenskaper för ${name}`, exact: true }).click();
  await expect(subscription).toBeChecked();
  await subscription.focus(); await page.keyboard.press("Space");
  await expect(subscription).not.toBeChecked();
  await page.keyboard.press("Escape");
  await openSettings(page);
  await page.getByLabel("Språk", { exact: true }).selectOption("en");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await controls.getByRole("button", { name: `Repository properties for ${name}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Repository properties", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: `Notifications for ${name}`, exact: true })).not.toBeChecked();
});
