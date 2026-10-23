import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { afterEach, expect, it } from 'vitest';
import StatisticsLoadingProgress from '../src/components/StatisticsLoadingProgress.vue';
import { setLanguage } from '../src/lib/i18n';
import type { StatisticsLoadStatus } from '../src/lib/statistics-load-status';
const base: StatisticsLoadStatus = { phase: 'lists', collectionFrom: '2026-09-20T00:00:00Z', collectionTo: '2026-10-20T12:00:00Z', sourcesDone: 2, sourcesTotal: 4, completeSources: 1 };
afterEach(() => setLanguage('auto'));
it('renders unknown discovery without percentage, ETA or a falsely determinate progress bar', async () => {
  setLanguage('sv');
  const html = await renderToString(createSSRApp(StatisticsLoadingProgress, { status: { ...base, oldestActivityAt: Date.parse('2026-09-30T12:00:00Z'), reachedDays: 20 } }));
  expect(html).toContain('Kontrollerar underlag: 2 av 4 källor.');
  for (const repeated of ['Fullt hämtade underlag', 'Insamlingsperiod', 'Visad period', 'Äldsta hittade aktivitet']) expect(html).not.toContain(repeated);
  expect(html).not.toContain('<progress');
  expect(html).not.toContain('Ungefär');
  expect(html).not.toContain(' %');
});
it('renders accessible known diff work and only a supplied measured time estimate', async () => {
  setLanguage('sv');
  const status: StatisticsLoadStatus = { ...base, phase: 'changes', diffsDone: 3, diffsTotal: 5, percent: 60, remainingMs: 4000 };
  const html = await renderToString(createSSRApp(StatisticsLoadingProgress, { status }));
  expect(html).toContain('Kodändringar: 3 av 5 commits (60 %).');
  expect(html).toContain('Ungefär 4 s kvar.');
  expect(html).toContain('aria-label="Statistikhämtning"');
  expect(html).toContain('<progress max="100" value="60"');
  const withoutEta = await renderToString(createSSRApp(StatisticsLoadingProgress, { status: { ...status, remainingMs: undefined } }));
  expect(withoutEta).not.toContain('Ungefär');
});
