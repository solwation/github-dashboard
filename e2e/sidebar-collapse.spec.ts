import { expect, test } from "@playwright/test";

test("sidebar activation toggles the focused repository independently in Overview and Statistics", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Utforska en demo", exact: true }).click();
  await page.getByRole("button", { name: "Inställningar", exact: true }).click();
  await page.getByLabel("Visa max work items per kolumn", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Klart", exact: true }).click();
  const designLink = page.locator('.sidebar-repository-row[data-repository="demo/design-system"] .sidebar-repository');
  const weekendLink = page.locator('.sidebar-repository-row[data-repository="demo/weekend-project"] .sidebar-repository');
  const board = page.locator('#repo-1');
  await board.getByRole("button", { name: "Kollapsa design-system", exact: true }).click();
  await designLink.click();
  await expect(board.locator(".swimlane")).toBeVisible();
  await expect(board).toHaveClass(/repository-navigation-highlight/);
  await board.locator('.backlog').getByRole('button', { name: 'Visa fler', exact: true }).click();
  await expect(board.locator('.backlog .issue-card')).toHaveCount(2);
  await designLink.press("Enter");
  await expect(board.locator(".swimlane")).toBeHidden();
  await expect(page).toHaveURL(/#repo-1$/);
  // Repeated activation after the highlight expires still toggles the focused repository.
  await expect(board).not.toHaveClass(/repository-navigation-highlight/);
  await designLink.press("Enter");
  await expect(board.locator(".swimlane")).toBeVisible();
  await expect(board.locator('.backlog .issue-card')).toHaveCount(1);
  await weekendLink.click();
  await designLink.click();
  await expect(board.locator(".swimlane")).toBeVisible();
  await designLink.click();
  await expect(board.locator(".swimlane")).toBeHidden();

  await page.getByRole("link", { name: "Statistik", exact: true }).click();
  const statistics = page.locator('#statistics-repo-1');
  await expect(statistics).toBeVisible();
  await designLink.click();
  await expect(statistics.locator('.statistics-repository-body')).toBeVisible();
  await expect(page).toHaveURL(/#statistics-repo-1$/);
  await designLink.press("Enter");
  await expect(statistics.locator('.statistics-repository-body')).toBeHidden();
  await expect(statistics).not.toHaveClass(/repository-navigation-highlight/);
  await expect(statistics.locator('.statistics-repository-body')).toBeHidden();
  await designLink.press("Enter");
  await expect(statistics.locator('.statistics-repository-body')).toBeVisible();
  await weekendLink.click();
  await designLink.click();
  await expect(statistics.locator('.statistics-repository-body')).toBeVisible();
  await designLink.click();
  await expect(statistics.locator('.statistics-repository-body')).toBeHidden();
  await page.getByRole("link", { name: "Översikt", exact: true }).click();
  await expect(board.locator(".swimlane")).toBeHidden();
  await designLink.click();
  await expect(board.locator(".swimlane")).toBeVisible();

  // Modifier activation remains a native link and does not toggle the current repository.
  const prevented = await designLink.evaluate(element => {
    let preventedByApp = true;
    window.addEventListener('click', event => { preventedByApp = event.defaultPrevented; event.preventDefault(); }, { once: true });
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
    return preventedByApp;
  });
  expect(prevented).toBe(false);
  await expect(board.locator(".swimlane")).toBeVisible();
});
