import { expect, test, type Locator, type Page } from '@playwright/test';

async function signIn(page: Page) {
  const repos = [{ id: 1, name: 'first', full_name: 'sample/first', private: true, description: 'Fixture',
    html_url: 'https://github.com/sample/first', owner: { login: 'sample' } }];
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    // A denied optional permission keeps the Settings notice badge visible.
    if (url.pathname.endsWith('/commits')) {
      await route.fulfill({ status: 403, json: { message: 'Resource not accessible by personal access token' } }); return;
    }
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'topbar-test', avatar_url: '' }
      : url.pathname === '/user/repos' ? repos
      : repos.find(repo => `/repos/${repo.full_name}` === url.pathname) ?? [] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Anslut GitHub', exact: true }).click();
  await page.getByLabel('GitHub personal access token').fill('fixture-topbar-token');
  await page.getByRole('button', { name: 'Anslut konto', exact: true }).click();
  await page.getByRole('checkbox', { name: 'sample/first' }).check();
  await page.getByRole('button', { name: 'Visa översikt' }).click();
  await expect(page.locator('.repo-lane')).toHaveCount(1);
}

const box = async (locator: Locator) => (await locator.boundingBox())!;

async function expectPhoneTopbar(page: Page, settingsName: string, logoutName: string) {
  const topbar = page.locator('.topbar');
  const settings = topbar.getByRole('button', { name: settingsName, exact: true });
  const qr = topbar.locator('.handoff-button');
  const avatar = topbar.locator('.avatar');
  const logout = topbar.getByRole('button', { name: logoutName, exact: true });
  await expect(topbar.locator('#settings-notices')).toBeVisible();
  const [bar, settingsBox, qrBox, avatarBox, logoutBox] = await Promise.all([topbar, settings, qr, avatar, logout].map(box));
  // Settings and QR stay left, avatar and logout reach the right edge of the topbar.
  expect(settingsBox.x).toBeLessThan(bar.width / 2);
  expect(qrBox.x + qrBox.width).toBeLessThan(avatarBox.x);
  expect(avatarBox.x + avatarBox.width).toBeLessThan(logoutBox.x);
  expect(bar.x + bar.width - (logoutBox.x + logoutBox.width)).toBeLessThanOrEqual(24);
  // All controls share a single row.
  const centre = (b: { y: number; height: number }) => b.y + b.height / 2;
  for (const control of [qrBox, avatarBox, logoutBox]) expect(Math.abs(centre(control) - centre(settingsBox))).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('phone topbar right-aligns account controls and keeps connection status accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  await page.evaluate(() => scrollTo(0, 0));
  await expectPhoneTopbar(page, 'Inställningar', 'Logga ut');
  await page.screenshot({ path: test.info().outputPath('topbar-375-sv.png'), clip: { x: 0, y: 0, width: 375, height: 200 } });

  const connection = page.locator('.topbar .connection');
  const label = connection.locator('.connection-label');
  // Text is visually hidden but stays in the accessibility tree and as a tooltip.
  const labelBox = await box(label);
  expect(labelBox.width * labelBox.height).toBeLessThanOrEqual(1);
  await expect(label).toHaveText('GitHub anslutet');
  await expect(connection).toHaveAttribute('title', 'GitHub anslutet');
  await expect(page.locator('.topbar .avatar')).toHaveAttribute('title', 'topbar-test · GitHub anslutet');

  // Logout keeps its accessible name and confirmation dialog.
  await page.getByRole('button', { name: 'Logga ut', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Logga ut?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Avbryt' }).click();
  await expect(dialog).not.toBeVisible();

  // Longer English labels still fit on one row.
  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await page.locator('#language-preference').selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expectPhoneTopbar(page, 'Settings', 'Sign out');
  await expect(label).toHaveText('GitHub connected');
  await page.screenshot({ path: test.info().outputPath('topbar-375-en.png'), clip: { x: 0, y: 0, width: 375, height: 200 } });

  // Wider screens keep the visible connection text.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(label).toBeVisible();
  expect((await box(label)).width).toBeGreaterThan(40);
});

test('phone topbar keeps the demo status visible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Utforska en demo' }).click();
  const label = page.locator('.topbar .connection-label');
  await expect(label).toHaveText('Demoläge');
  expect((await box(label)).width).toBeGreaterThan(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
