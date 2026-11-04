import { expect, type Page } from "@playwright/test";
import { openSettings, closePhoneMenu } from "./phone-menu";

/** Change the existing account filter through its Settings entry. */
export async function setHideCoordination(page: Page, hidden: boolean) {
  await openSettings(page);
  const control = page.getByRole("checkbox", { name: "Dölj koordinationsärenden", exact: true });
  await control.setChecked(hidden);
  await expect(control).toBeChecked({ checked: hidden });
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await closePhoneMenu(page);
}

export async function expectHideCoordination(page: Page, hidden: boolean) {
  await openSettings(page);
  await expect(page.getByRole("checkbox", { name: "Dölj koordinationsärenden", exact: true })).toBeChecked({ checked: hidden });
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await closePhoneMenu(page);
}
