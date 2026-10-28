import { expect, test } from '@playwright/test';

for (const width of [1440, 320]) {
  test(`repository collapse preserves filters and point selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Utforska en demo', exact: true }).click();
    await page.getByRole('link', { name: 'Statistik', exact: true }).click();
    const repository = page.locator('#statistics-repo-1');
    const other = page.locator('#statistics-repo-2');
    const chart = repository.locator('.statistics-chart');
    await expect(repository.locator('.statistics-breakdowns, .statistics-breakdown')).toHaveCount(0);
    await repository.getByRole('combobox', { name: 'Bidragsgivare', exact: true }).selectOption('demo-alex');
    const created = repository.getByRole('group', { name: 'Mätvärden i diagrammet' }).getByRole('button', { name: 'Skapade issues' });
    await created.click();
    await expect(chart.locator('.chart-day')).toHaveCount(0);
    const keyboard = chart.locator('.chart-keyboard-control');
    await expect(keyboard).toHaveCSS('clip-path', 'inset(50%)');
    const beforeHeight = (await chart.boundingBox())!.height;
    // The native slider remains in the natural tab sequence, without a separate visible row.
    await repository.locator('.statistics-totals button').last().focus();
    await page.keyboard.press('Tab');
    const slider = chart.getByRole('slider', { name: 'Tidpunkt i diagrammet', exact: true });
    await expect(slider).toBeFocused();
    await expect(keyboard).toHaveCSS('clip-path', 'none');
    await slider.press('End');
    const point = await slider.inputValue();
    await expect(chart.getByRole('tooltip')).toContainText('Skapade issues');
    await expect(chart.locator('.chart-selection-time')).not.toBeEmpty();
    await expect(slider).toHaveAttribute('aria-valuetext', /Skapade issues: \d/);
    // Focus-only keyboard controls do not add a row or resize the chart.
    expect((await chart.boundingBox())!.height).toBe(beforeHeight);
    await chart.evaluate(element => element.setAttribute('data-instance', 'retained'));
    const collapse = repository.locator('.statistics-repository-toggle');
    await expect(collapse).toHaveAttribute('aria-label', 'Kollapsa demo/design-system');
    await collapse.focus(); await collapse.press('Space');
    await expect(collapse).toHaveAttribute('aria-expanded', 'false');
    await expect(repository.locator('.statistics-repository-heading')).toBeVisible();
    await expect(repository.locator('.statistics-repository-body')).toBeHidden();
    await expect(other.locator('.statistics-repository-body')).toBeHidden();
    await expect(chart).toHaveAttribute('data-instance', 'retained');
    await collapse.press('Enter');
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(created).toHaveAttribute('aria-pressed', 'true');
    await expect(repository.getByRole('combobox', { name: 'Bidragsgivare', exact: true })).toHaveValue('demo-alex');
    await expect(slider).toHaveValue(point);
    await expect(keyboard).toHaveCSS('clip-path', 'inset(50%)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('sidebar navigation reveals a collapsed repository including a repeated click on the same fragment', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Utforska en demo', exact: true }).click();
  await page.getByRole('link', { name: 'Statistik', exact: true }).click();
  const target = page.locator('#statistics-repo-2');
  const link = page.locator('.sidebar-repository-row[data-repository="demo/weekend-project"] .sidebar-repository');
  await target.getByRole('button', { name: 'Expandera demo/weekend-project', exact: true }).click();
  for (let attempt = 0; attempt < 2; attempt++) {
    await target.getByRole('button', { name: 'Kollapsa demo/weekend-project', exact: true }).click();
    await expect(target.locator('.statistics-repository-body')).toBeHidden();
    await link.click();
    await expect(page).toHaveURL(/#statistics-repo-2$/);
    await expect(target.locator('.statistics-repository-body')).toBeVisible();
    await expect(target.locator('h2')).toBeInViewport();
  }
});
