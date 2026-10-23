<script setup lang="ts">
import { computed } from 'vue';
import { useLanguage } from '../lib/i18n';
import { parseStatisticsBound } from '../lib/statistics';
import type { StatisticsLoadStatus } from '../lib/statistics-load-status';
const props = defineProps<{ status: StatisticsLoadStatus; selectedFrom: string; selectedTo: string }>();
const { t, locale } = useLanguage();
function date(time: number) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'short' }).format(time);
}
const collectionFrom = computed(() => date(Date.parse(props.status.collectionFrom)));
const collectionTo = computed(() => date(Date.parse(props.status.collectionTo)));
const selectedFromLabel = computed(() => date(parseStatisticsBound(props.selectedFrom, 'start')));
const selectedToLabel = computed(() => date(parseStatisticsBound(props.selectedTo, 'end')));
const remaining = computed(() => {
  const ms = props.status.remainingMs;
  if (ms === undefined) return '';
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return t('{count} s', { count: seconds });
  if (seconds < 3600) return t('{count} min', { count: Math.ceil(seconds / 60) });
  return t('{count} h', { count: Math.ceil(seconds / 3600) });
});
</script>
<template>
  <section class="statistics-load-progress" :aria-label="t('Statistikhämtning')">
    <div class="statistics-load-row statistics-load-heading">
      <span class="statistics-load-activity" aria-hidden="true"><span class="statistics-load-spinner" /></span>
      <p class="statistics-load-phase" aria-live="polite" aria-atomic="true">
        <template v-if="status.phase === 'lists'">{{ t('Kontrollerar underlag: {done} av {total} källor.', { done: status.sourcesDone, total: status.sourcesTotal }) }}</template>
        <template v-else>{{ t('Kodändringar: {done} av {total} commits ({percent} %).', { done: status.diffsDone ?? 0, total: status.diffsTotal ?? 0, percent: status.percent ?? 0 }) }}</template>
      </p>
      <p v-if="remaining" class="statistics-load-eta">{{ t('Ungefär {time} kvar.', { time: remaining }) }}</p>
    </div>
    <progress v-if="status.phase === 'changes' && status.diffsTotal" :max="100" :value="status.percent" :aria-label="t('Statistikhämtning')" />
    <div class="statistics-load-row statistics-load-details">
      <p>{{ t('Fullt hämtade underlag: {done} av {total}.', { done: status.completeSources, total: status.sourcesTotal }) }}</p>
      <p v-if="status.oldestActivityAt !== undefined" :title="t('Äldre aktivitet betyder inte att hela perioden är färdighämtad.')">
        {{ t('Äldsta hittade aktivitet: {date} (cirka {days} dagar bakåt).', { date: date(status.oldestActivityAt), days: status.reachedDays ?? 0 }) }}
        <span class="sr-only">{{ t('Äldre aktivitet betyder inte att hela perioden är färdighämtad.') }}</span>
      </p>
    </div>
    <div class="statistics-load-row statistics-load-windows">
      <p>{{ t('Insamlingsperiod: {from} – {to}.', { from: collectionFrom, to: collectionTo }) }}</p>
      <p>{{ t('Visad period: {from} – {to}.', { from: selectedFromLabel, to: selectedToLabel }) }}</p>
    </div>
  </section>
</template>
<style scoped>
.statistics-load-progress { display: grid; gap: 10px; padding: 14px 16px; margin-bottom: 14px; border: 1px solid color-mix(in srgb, var(--green) 25%, var(--line)); border-radius: 10px; background: color-mix(in srgb, var(--green) 4%, var(--surface)); color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.statistics-load-progress p { margin: 0; }
.statistics-load-activity { display: grid; place-items: center; flex: 0 0 30px; height: 30px; border-radius: 50%; background: color-mix(in srgb, var(--green) 12%, var(--surface)); }
.statistics-load-spinner { width: 15px; height: 15px; border: 2px solid color-mix(in srgb, var(--green) 25%, transparent); border-top-color: var(--green); border-right-color: var(--green); border-radius: 50%; animation: statistics-load-spin .9s linear infinite; }
.statistics-load-phase { color: var(--text); font-weight: 600; }
.statistics-load-heading .statistics-load-phase { flex: 1 1 180px; min-width: 0; }
.statistics-load-progress progress { appearance: none; width: 100%; height: 6px; border: 0; border-radius: 999px; overflow: hidden; background: var(--line); accent-color: var(--green); }
.statistics-load-progress progress::-webkit-progress-bar { background: var(--line); border-radius: 999px; }
.statistics-load-progress progress::-webkit-progress-value { background: var(--green); border-radius: 999px; }
.statistics-load-progress progress::-moz-progress-bar { background: var(--green); border-radius: 999px; }
.statistics-load-eta { color: var(--text); font-variant-numeric: tabular-nums; }
.statistics-load-row { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; }
.statistics-load-heading { align-items: center; justify-content: flex-start; gap: 8px 10px; }
.statistics-load-details { padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--green) 12%, var(--line)); }
.statistics-load-windows { font-size: 11px; }
@keyframes statistics-load-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .statistics-load-spinner { animation: none; } }
@media (max-width: 650px) { .statistics-load-progress { gap: 8px; padding: 10px 12px; } }
</style>
