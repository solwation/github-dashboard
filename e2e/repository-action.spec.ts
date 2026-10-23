import { expect, test, type Page } from "@playwright/test";
import { openSettings } from "./support/phone-menu";

async function connect(page: Page) {
  let gate: Promise<void> | undefined;
  let release = () => {};
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname === "/user") data = { login: "picker-fixture", avatar_url: "" };
    if (url.pathname === "/user/repos") data = ["alpha", "beta"].map((name, index) => ({
      id: index + 1, name, full_name: `sample/${name}`, private: false,
      html_url: `https://github.com/sample/${name}`, owner: { login: "sample" },
    }));
    if (url.pathname.endsWith("/issues")) await gate;
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-picker-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  await page.getByRole("checkbox", { name: "sample/alpha" }).check();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
  return {
    pause: () => { gate = new Promise(resolve => { release = resolve; }); },
    release: () => { gate = undefined; release(); },
  };
}

for (const width of [1440, 320]) {
  test(`repository card opens the picker, keeps count and stays available while loading at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const api = await connect(page);
    const card = page.locator(".repository-stat");
    const action = card.getByRole("button", { name: "Välj repositories", exact: true });
    await expect(page.locator(".page-heading button")).toHaveCount(0);
    await expect(page.locator(".sidebar-add")).toBeAttached();
    await expect(card.locator("strong")).toHaveText("10 aktiva");
    await expect(action).toBeVisible();
    const cardBox = (await card.boundingBox())!;
    const actionBox = (await action.boundingBox())!;
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(actionBox.x).toBeGreaterThanOrEqual(cardBox.x);
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Välj repositories" })).toBeVisible();
    await page.getByRole("checkbox", { name: "sample/beta" }).check();
    api.pause();
    await page.getByRole("button", { name: "Visa översikt" }).click();
    // The picker stays reachable while the new selection loads (#98), like the sidebar picker.
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "true");
    await expect(action).toBeEnabled();
    await action.focus();
    await expect(action).toBeFocused();
    api.release();
    await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
    await expect(action).toBeEnabled();
    await expect(card.locator("strong")).toHaveText("20 aktiva");
    await openSettings(page);
    await page.getByLabel("Språk", { exact: true }).selectOption("en");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(card.getByRole("button", { name: "Choose repositories", exact: true })).toBeVisible();
  });
}

test("empty overview retains its picker action and demo cannot select repositories", async ({ page }) => {
  await connect(page);
  await page.locator(".repository-stat-action").click();
  await page.getByRole("checkbox", { name: "sample/alpha" }).uncheck();
  await page.getByRole("button", { name: "Visa översikt" }).click();
  await expect(page.locator(".empty-state").getByRole("button", { name: "Välj repositories", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Logga ut", exact: true }).click();
  await page.getByRole("button", { name: "Logga ut och ta bort token", exact: true }).click();
  await page.getByRole("button", { name: "Utforska en demo" }).click();
  await expect(page.locator(".repository-stat-action")).toHaveCount(0);
  await expect(page.locator(".sidebar-add")).toHaveCount(0);
});
