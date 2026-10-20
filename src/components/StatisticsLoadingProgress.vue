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
    <div class="statistics-load-row">
      <p class="statistics-load-phase" aria-live="polite" aria-atomic="true">
        <template v-if="status.phase === 'lists'">{{ t('Kontrollerar underlag: {done} av {total} källor.', { done: status.sourcesDone, total: status.sourcesTotal }) }}</template>
        <template v-else>{{ t('Kodändringar: {done} av {total} commits ({percent} %).', { done: status.diffsDone ?? 0, total: status.diffsTotal ?? 0, percent: status.percent ?? 0 }) }}</template>
      </p>
      <p v-if="remaining" class="statistics-load-eta">{{ t('Ungefär {time} kvar.', { time: remaining }) }}</p>
    </div>
    <progress v-if="status.phase === 'changes' && status.diffsTotal" :max="100" :value="status.percent" :aria-label="t('Statistikhämtning')" />
    <div class="statistics-load-row">
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
.statistics-load-progress { display: grid; gap: 5px; padding: 12px 14px; margin-bottom: 14px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.statistics-load-progress p { margin: 0; }
.statistics-load-phase { color: var(--text); font-weight: 600; }
.statistics-load-progress progress { width: 100%; height: 7px; accent-color: var(--green); }
.statistics-load-eta { color: var(--text); }
.statistics-load-row { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; }
.statistics-load-windows { font-size: 11px; }
</style>
