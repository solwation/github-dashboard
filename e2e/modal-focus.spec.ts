import { expect, test, type Locator, type Page } from "@playwright/test";

async function fixture(page: Page) {
  const repos = ["alpha", "beta"].map((name, index) => ({ id: index + 1, name, full_name: `sample/${name}`, description: "Fictional focus fixture", private: false, html_url: `https://github.com/sample/${name}`, owner: { login: "sample" } }));
  await page.route("https://api.github.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/user") return route.fulfill({ json: { login: "focus-fixture", avatar_url: "" } });
    if (url.pathname === "/user/repos") return route.fulfill({ json: repos });
    if (url.pathname.endsWith("/issues") && url.searchParams.has("state")) {
      const repo = repos.find(repo => url.pathname.includes(`/${repo.name}/`))!;
      const now = new Date().toISOString();
      return route.fulfill({ json: url.searchParams.get("state") === "closed" ? [] : [{ id: repo.id, number: 1, title: `${repo.name} task`, state: "open", created_at: now, updated_at: now, closed_at: null, labels: [], assignees: [], html_url: `${repo.html_url}/issues/1` }] });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Anslut GitHub", exact: true }).click();
  await page.getByLabel("GitHub personal access token").fill("fictional-modal-focus-token");
  await page.getByRole("button", { name: "Anslut konto", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  await dialog.getByRole("checkbox", { name: "sample/alpha" }).check();
  await dialog.getByRole("button", { name: "Visa översikt", exact: true }).click();
  await expect(page.locator(".issue-card")).toHaveCount(1);
}

const insideDialog = (dialog: Locator) => dialog.evaluate(element => element.contains(document.activeElement));

async function expectTrapped(page: Page, dialog: Locator, first: Locator, last: Locator) {
  // Closed native settings/install dialogs stay in the DOM and must not be part of the trap.
  expect(await page.locator("dialog.native-modal:not([open])").count()).toBeGreaterThanOrEqual(2);
  expect(await insideDialog(dialog)).toBe(true);
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Tab");
    expect(await insideDialog(dialog)).toBe(true);
  }
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("Shift+Tab");
    expect(await insideDialog(dialog)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("repository picker traps focus, closes with Escape and restores focus to its opener", async ({ page }) => {
  await fixture(page);
  const opener = page.locator(".sidebar-add");
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Välj repositories", exact: true });
  await expect(dialog).toBeVisible();
  await expectTrapped(page, dialog, dialog.getByRole("button", { name: "Stäng", exact: true }), dialog.getByRole("button", { name: "Visa översikt", exact: true }));
  await expect(opener).toBeFocused();
});

test("label dialog traps focus, closes with Escape and restores focus to its opener", async ({ page }) => {
  await fixture(page);
  const opener = page.getByRole("button", { name: "Repositoryegenskaper för alpha", exact: true });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Repositoryegenskaper", exact: true });
  await expect(dialog).toBeVisible();
  await expectTrapped(page, dialog, dialog.getByRole("button", { name: "Stäng", exact: true }), dialog.getByRole("button", { name: "Spara och hämta igen", exact: true }));
  await expect(opener).toBeFocused();
});
