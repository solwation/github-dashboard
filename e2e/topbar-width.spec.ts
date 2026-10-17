import { expect, test, type Page } from '@playwright/test';

// Issue #113: the signed-in topbar must fit between the phone breakpoint and wide screens.
async function signIn(page: Page) {
  const repos = [{ id: 1, name: 'first', full_name: 'sample/first', private: true, description: 'Fixture',
    html_url: 'https://github.com/sample/first', owner: { login: 'sample' } }];
  await page.route('https://api.github.com/**', async route => {
    const url = new URL(route.request().url());
    // A denied optional permission keeps the Settings notice badge visible.
    if (url.pathname.endsWith('/commits')) {
      await route.fulfill({ status: 403, json: { message: 'Resource not accessible by personal access token' } }); return;
    }
    await route.fulfill({ json: url.pathname === '/user' ? { login: 'a-rather-long-login-name', avatar_url: '' }
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
  await expect(page.locator('.topbar #settings-notices')).toBeVisible();
}

type Rect = { left: number; right: number; top: number; bottom: number };

/** Measures overflow, overlap and control geometry of the topbar at the current width. */
const measure = (page: Page) => page.evaluate(() => {
  const rect = (el: Element): Rect => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const topbar = document.querySelector('.topbar')!;
  const controls = [...topbar.querySelectorAll('.topbar-right > *')]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
  return {
    overflow: document.documentElement.scrollWidth - innerWidth,
    topbar: rect(topbar),
    breadcrumb: rect(topbar.querySelector('.breadcrumb')!),
    controls: controls.map(el => ({ name: el.className || el.tagName, ...rect(el) })),
  };
});

const overlaps = (a: Rect, b: Rect) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

async function expectFits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  const m = await measure(page);
  expect(m.overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
  for (const control of m.controls) {
    expect(control.left, `${control.name} inside topbar at ${width}px`).toBeGreaterThanOrEqual(m.topbar.left);
    expect(control.right, `${control.name} inside viewport at ${width}px`).toBeLessThanOrEqual(width);
    expect(overlaps(control, m.breadcrumb), `${control.name} overlaps breadcrumb at ${width}px`).toBe(false);
  }
  for (let i = 0; i < m.controls.length; i++)
    for (let j = i + 1; j < m.controls.length; j++)
      expect(overlaps(m.controls[i], m.controls[j]), `${m.controls[i].name} / ${m.controls[j].name} at ${width}px`).toBe(false);
}

async function tabOrder(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.topbar button, .topbar a[href]')]
    .filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
    .map(el => el.getAttribute('aria-label') || el.textContent?.trim() || ''));
}

const widths = [320, 375, 500, 640, 651, 660, 700, 720, 768, 780, 800, 900, 950, 951, 1024, 1150, 1280, 1440];

test('signed-in topbar never overflows horizontally in Swedish and English', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  const wideOrder = await tabOrder(page);
  expect(wideOrder).toEqual(expect.arrayContaining(['Inställningar', 'Öppna på mobilen', 'Logga ut']));

  for (const width of widths) await expectFits(page, width);
  // Compact widths keep the same controls, names and keyboard order.
  await page.setViewportSize({ width: 700, height: 900 });
  expect(await tabOrder(page)).toEqual(wideOrder);
  await expect(page.locator('.topbar .connection-label')).toHaveText('GitHub anslutet');
  await expect(page.getByRole('button', { name: 'Öppna på mobilen', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('topbar-700-sv.png'), clip: { x: 0, y: 0, width: 700, height: 160 } });

  await page.getByRole('button', { name: 'Inställningar', exact: true }).click();
  await page.locator('#language-preference').selectOption('en');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  for (const width of widths) await expectFits(page, width);
  await page.setViewportSize({ width: 660, height: 900 });
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('topbar-660-en.png'), clip: { x: 0, y: 0, width: 660, height: 160 } });
});

test('demo topbar never overflows horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Utforska en demo' }).click();
  await expect(page.locator('.topbar .connection-label')).toHaveText('Demoläge');
  for (const width of widths) await expectFits(page, width);
});
