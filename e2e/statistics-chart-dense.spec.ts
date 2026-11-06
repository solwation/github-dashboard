import { expect, test } from '@playwright/test';

for (const touch of [false, true]) test(`dense hourly chart preserves gaps, zeroes and selection (${touch ? 'touch' : 'desktop'})`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: touch ? { width: 390, height: 844 } : { width: 1600, height: 1000 }, hasTouch: touch, isMobile: touch, locale: 'sv-SE', timezoneId: 'Europe/Stockholm', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(async () => {
    const vuePath = '/node_modules/.vite/deps/vue.js', chartPath = '/src/components/StatisticsChart.vue';
    const [{ createApp, h }, { default: Chart }] = await Promise.all([import(vuePath), import(chartPath)]);
    const host = document.createElement('main');
    host.style.cssText = 'padding:16px;width:100%;box-sizing:border-box';
    document.querySelector('#app')!.replaceChildren(host);
    const days = Array.from({ length: 720 }, (_, index) => {
      const start = Date.UTC(2026, 9, 1) + index * 3600000;
      return { date: new Date(start).toISOString().slice(0, 16).replace('T', ' '), start, values: { closed: index % 5, created: index === 12 ? undefined : index % 3, commits: index % 8 } };
    });
    createApp({ render: () => h(Chart, { title: 'Dense synthetic hourly chart', metric: 'closed', resolution: '1h', series: ['closed', 'created', 'commits'].map(metric => ({ name: metric, metric, days })) }) }).mount(host);
  });
  const chart = page.locator('.statistics-chart'), svg = chart.locator(':scope > svg'), slider = chart.getByRole('slider');
  await expect(svg.locator('circle')).toHaveCount(2159);
  await expect(svg.locator('polyline')).toHaveCount(4);
  const first = svg.locator('circle').first();
  const point = await first.boundingBox();
  if (touch) await page.touchscreen.tap(point!.x + point!.width / 2, point!.y + point!.height / 2);
  else await page.mouse.move(point!.x + point!.width / 2, point!.y + point!.height / 2);
  await expect(slider).toHaveValue('0');
  await expect(chart.getByRole('tooltip').locator('b')).toHaveText(['0', '0', '0']);
  await slider.focus(); await slider.press('End');
  await expect(slider).toHaveValue('719');
  await expect(chart.getByRole('tooltip').locator('b')).toHaveText(['4', '2', '7']);
  await expect(slider).toHaveAttribute('aria-valuetext', /closed: 4, created: 2, commits: 7/);
  await slider.press('Home');
  for (let index = 0; index < 12; index++) await slider.press('ArrowRight');
  await expect(chart.getByRole('tooltip').locator('b')).toHaveText(['2', '4']);
  await expect(chart.getByRole('tooltip')).not.toContainText('created');
  await slider.press('ArrowRight');
  await expect(chart.getByRole('tooltip').locator('b')).toHaveText(['3', '1', '5']);
  await expect(page.locator('body')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: testInfo.outputPath(`dense-${touch ? 'touch' : 'desktop'}-${theme}.png`) });
  }
  await context.close();
});
