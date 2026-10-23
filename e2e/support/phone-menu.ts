import { expect, type Page } from "@playwright/test";

/** Phone layouts keep Settings and account tools in the collapsed menu; open it there, do nothing on desktop (#266). */
export async function revealPhoneMenu(page: Page) {
  const button = page.locator(".mobile-menu-button");
  if (!(await button.isVisible())) return;
  const tools = page.locator(".mobile-tools");
  if (!/mobile-tools-open/.test((await tools.getAttribute("class")) ?? "")) await button.click();
  await expect(tools).toHaveClass(/mobile-tools-open/);
}

export async function openSettings(page: Page, name = "Inställningar", tap = false) {
  await revealPhoneMenu(page);
  const settings = page.getByRole("button", { name, exact: true });
  await (tap ? settings.tap() : settings.click());
}

/** The menu stays open after its dialogs close; close it before using the board underneath. */
export async function closePhoneMenu(page: Page) {
  const tools = page.locator(".mobile-tools");
  if (/mobile-tools-open/.test((await tools.getAttribute("class")) ?? "")) await page.locator(".mobile-menu-button").click();
  await expect(tools).not.toHaveClass(/mobile-tools-open/);
}
