import { expect, test } from "@playwright/test";
import { openSettings } from "./support/phone-menu";
test.use({ locale: "en-US" });
test("follows browser language, switches live in settings and remembers choice", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: /Track your AI agents/ }),
  ).toBeVisible();
  await openSettings(page, "Settings");
  await page.getByLabel("Language", { exact: true }).selectOption("sv");
  await expect(
    page.getByRole("heading", { name: "Inställningar", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Följ dina AI-agenter/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Inställningar", exact: true })
    .click();
  await page.getByLabel("Språk", { exact: true }).selectOption("auto");
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Explore a demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /Project overview/ }),
  ).toBeVisible();
  await expect(page.locator(".column-hint").first()).toHaveText(
    "Highest priority first",
  );
  await expect(page.locator(".closed-date").first()).toContainText(
    /ago|Closed/,
  );
});
