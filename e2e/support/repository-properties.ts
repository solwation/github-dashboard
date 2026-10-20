import { expect, type Locator, type Page } from "@playwright/test";

/** Open the local properties dialog, inspect or change its subscription, then return to the board. */
export async function repositoryNotification(page: Page, name: string, action: (toggle: Locator) => Promise<void>) {
  const opener = page.getByRole("button", { name: `Repositoryegenskaper för ${name}`, exact: true })
    .or(page.getByRole("button", { name: `Repository properties for ${name}`, exact: true }));
  await opener.click();
  const dialog = page.getByRole("dialog", { name: /^(Repositoryegenskaper|Repository properties)$/ });
  await action(dialog.getByRole("switch"));
  await dialog.getByRole("button", { name: /^(Stäng|Close)$/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".board-toolbar")).toHaveAttribute("data-busy", "false");
}
