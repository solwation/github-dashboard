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

// On phones the account controls live in the collapsed menu (.mobile-tools); open it before looking for them.
async function openPhoneMenu(page: Page) {
  const tools = page.locator('.mobile-tools');
  if (!/mobile-tools-open/.test((await tools.getAttribute('class')) ?? '')) await page.getByRole('button', { name: 'Meny', exact: true }).click();
  await expect(tools).toHaveClass(/mobile-tools-open/);
  return page.locator('#mobile-tools-menu');
}

async function expectPhoneTopbar(page: Page, settingsName: string, logoutName: string) {
  const topbar = page.locator('.topbar');
  const menu = await openPhoneMenu(page);
  const settings = menu.getByRole('button', { name: settingsName, exact: true });
  const qr = menu.locator('.handoff-button');
  const avatar = menu.locator('.avatar');
  const logout = menu.getByRole('button', { name: logoutName, exact: true });
  await expect(menu.locator('#settings-notices')).toBeVisible();
  const [bar, menuBox, settingsBox, qrBox, avatarBox, logoutBox] = await Promise.all([topbar, menu, settings, qr, avatar, logout].map(box));
  // The menu is a panel inside the viewport, anchored to the right edge, and stacks the controls in rows.
  const viewport = page.viewportSize()!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width);
  expect(viewport.width - (menuBox.x + menuBox.width)).toBeLessThanOrEqual(24);
  expect(bar.x + bar.width).toBeLessThanOrEqual(viewport.width);
  for (const control of [settingsBox, qrBox, avatarBox, logoutBox]) {
    expect(control.x).toBeGreaterThanOrEqual(menuBox.x);
    expect(control.x + control.width).toBeLessThanOrEqual(menuBox.x + menuBox.width + 1);
  }
  expect(settingsBox.y).toBeLessThan(qrBox.y);
  expect(qrBox.y).toBeLessThan(avatarBox.y);
  expect(logoutBox.y).not.toBe(avatarBox.y); // stacked rows, never overlapping
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('phone topbar right-aligns account controls and keeps connection status accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  await page.evaluate(() => scrollTo(0, 0));
  await expectPhoneTopbar(page, 'Inställningar', 'Logga ut');
  await page.screenshot({ path: test.info().outputPath('topbar-375-sv.png'), clip: { x: 0, y: 0, width: 375, height: 200 } });

  const timezone = page.locator('.topbar .account-timezone');
  await expect(timezone).toHaveCount(1);
  await expect(timezone).toHaveText(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone));
  await expect(timezone).toBeVisible();
  const connection = page.locator('.topbar .connection');
  const label = connection.locator('.connection-label');
  // Reachable in the open menu: visible text plus accessible name and tooltip.
  await expect(label).toBeVisible();
  await expect(label).toHaveText('GitHub anslutet');
  await expect(connection).toHaveAttribute('title', 'GitHub anslutet');
  await expect(page.locator('.topbar .avatar')).toHaveAttribute('title', 'topbar-test · GitHub anslutet');

  // Logout keeps its accessible name and confirmation dialog.
  await (await openPhoneMenu(page)).getByRole('button', { name: 'Logga ut', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Logga ut?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Avbryt' }).click();
  await expect(dialog).not.toBeVisible();

  // Longer English labels still fit on one row.
  await (await openPhoneMenu(page)).getByRole('button', { name: 'Inställningar', exact: true }).click();
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
  await openPhoneMenu(page);
  const label = page.locator('.topbar .connection-label');
  await expect(label).toHaveText('Demoläge');
  expect((await box(label)).width).toBeGreaterThan(20);
  await expect(page.locator('.topbar .account-timezone')).toHaveCount(1);
  await expect(page.locator('.topbar .account-timezone')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
