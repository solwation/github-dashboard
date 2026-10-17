<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BarChart3, RefreshCw } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Repo } from "../lib/model";
import { normalizeStatisticsPreference } from "../lib/statistics-preferences";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, DEFAULT_STATISTICS_RANGE,
  statisticsDimensions, statisticsDurationMs, statisticsMetrics, statisticsRanges, statisticsResolutions, summarizeStatistics,
  type StatisticsData, type StatisticsFilter, type StatisticsMetric, type StatisticsPreference, type StatisticsRangePreset, type StatisticsResolution,
} from "../lib/statistics";
import StatisticsChart from "./StatisticsChart.vue";
const { t, locale } = useLanguage();
const props = defineProps<{ repository: Repo; data: StatisticsData | null; loading: boolean; loadFailed: boolean; period: { from: string; to: string }; preference?: StatisticsPreference }>();
const emit = defineEmits<{ "update:preference": [value: StatisticsPreference] }>();
const state = ref<StatisticsPreference>(normalizeStatisticsPreference(props.preference, props.period));
const metricNames: Record<StatisticsMetric, string> = {
  closed: "Stängda issues", created: "Skapade issues", reopened: "Återöppnade issues", netIssues: "Nettoförändring av issues",
  commits: "Commits", additions: "Tillagda rader", deletions: "Borttagna rader", netLines: "Nettoförändring av kod", files: "Filändringar",
  prsOpened: "Öppnade pull requests", prsMerged: "Mergade pull requests", prsClosed: "Stängda pull requests utan merge",
};
const rangeNames: Record<StatisticsRangePreset, string> = {
  "8h": "8h", "12h": "12h", "24h": "24h",
  "3d": "3 dagar", "7d": "7 dagar", "21d": "3 veckor", "30d": "30 dagar",
};
const resolutionNames: Record<StatisticsResolution, string> = {
  "1m": "1 min", "5m": "5 min", "15m": "15 min", "30m": "30 min",
  "1h": "1 h", "6h": "6 h", "12h": "12 h", "1d": "1 dag",
};
const datasets = computed(() => props.data ? [props.data] : []);
const dimensions = computed(() => statisticsDimensions(datasets.value));
let cachedData: StatisticsData[] | null = null;
const summaryCache = new Map<string, ReturnType<typeof summarizeStatistics>>();
function summarize(filter: StatisticsFilter) {
  const data = datasets.value;
  if (cachedData !== data) { cachedData = data; summaryCache.clear(); }
  const key = JSON.stringify([filter.from, filter.to, filter.label, filter.contributor, filter.range || "", filter.resolution || ""]);
  let cached = summaryCache.get(key);
  if (!cached) {
    cached = summarizeStatistics(data, filter);
    summaryCache.set(key, cached);
  }
  return cached;
}
const summary = computed(() => summarize({ from: state.value.from, to: state.value.to, label: state.value.label, contributor: state.value.contributor }));
const availableMetrics = computed(() => statisticsMetrics.filter(key => summary.value.totals[key] !== undefined));
const anyData = computed(() => availableMetrics.value.length > 0);
const temporary = computed(() => props.loadFailed || !!props.data?.temporary.length);
const customDateRange = computed(() => state.value.from !== props.period.from || state.value.to !== props.period.to);
const activeRange = computed<StatisticsRangePreset | undefined>(() =>
  customDateRange.value ? undefined : (state.value.range || DEFAULT_STATISTICS_RANGE),
);
const chartDurationMs = computed(() =>
  statisticsDurationMs({ from: state.value.from, to: state.value.to, range: activeRange.value }),
);
const allowedResolutions = computed(() => new Set(allowedStatisticsResolutions(chartDurationMs.value)));
const activeResolution = computed<StatisticsResolution>(() =>
  clampStatisticsResolution(state.value.resolution, chartDurationMs.value, activeRange.value),
);
const selectedMetrics = computed<StatisticsMetric[]>(() => {
  const raw = state.value.metrics?.length ? state.value.metrics : [state.value.metric];
  const valid = raw.filter(key => availableMetrics.value.includes(key));
  return valid.length ? valid : availableMetrics.value.slice(0, 1);
});
const chartSummary = computed(() =>
  summarize({
    from: state.value.from,
    to: state.value.to,
    label: state.value.label,
    contributor: state.value.contributor,
    range: activeRange.value,
    resolution: activeResolution.value,
  }),
);
const chartSeries = computed(() => {
  if (!props.data) return [];
  const metrics = selectedMetrics.value;
  if (!metrics.length) return [];
  if (metrics.length === 1) {
    const metric = metrics[0]!;
    return summary.value.totals[metric] !== undefined
      ? [{ name: props.repository.full_name, metric, days: chartSummary.value.days }]
      : [];
  }
  return metrics.map(metric => ({
    name: t(metricNames[metric]),
    metric,
    days: chartSummary.value.days,
  }));
});
const chartTitle = computed(() =>
  selectedMetrics.value.map(metric => t(metricNames[metric])).join(", ") || t(metricNames[state.value.metric]),
);
const invalidRange = computed(() => !state.value.from || !state.value.to || state.value.from > state.value.to);
const filtersActive = computed(() =>
  state.value.from !== props.period.from ||
  state.value.to !== props.period.to ||
  !!state.value.label ||
  !!state.value.contributor ||
  (!!state.value.range && state.value.range !== DEFAULT_STATISTICS_RANGE) ||
  !!state.value.resolution ||
  (state.value.metrics?.length ?? 0) > 1,
);
const lastFetched = computed(() => {
  const values = props.data ? [props.data.issues, props.data.events, props.data.commits, props.data.changes, props.data.pulls].filter(value => !!value).map(value => value!.fetchedAt) : [];
  return values.length ? Math.min(...values) : 0;
});
function number(value: number) { return value.toLocaleString(locale.value); }
function normalize(value: StatisticsPreference | undefined) {
  const choices = props.data ? dimensions.value : undefined;
  const normalized = normalizeStatisticsPreference(value, props.period, choices);
  if (props.data) {
    const totals = summarize({ from: normalized.from, to: normalized.to, label: normalized.label, contributor: normalized.contributor }).totals;
    const metrics = statisticsMetrics.filter(key => totals[key] !== undefined);
    return normalizeStatisticsPreference(normalized, props.period, { ...dimensions.value, metrics });
  }
  return normalized;
}
function publish(value: StatisticsPreference) {
  if (JSON.stringify(value) !== JSON.stringify(props.preference)) emit("update:preference", { ...value });
}
watch([() => props.preference, () => props.data, () => props.period], () => {
  const normalized = normalize(props.preference);
  if (JSON.stringify(state.value) !== JSON.stringify(normalized)) state.value = normalized;
  publish(normalized);
}, { immediate: true, deep: true });
watch(state, value => {
  const normalized = normalize(value);
  if (JSON.stringify(value) !== JSON.stringify(normalized)) state.value = normalized;
  publish(normalized);
}, { deep: true });
function selectRange(preset: StatisticsRangePreset) {
  const duration = statisticsDurationMs({ from: props.period.from, to: props.period.to, range: preset });
  const nextResolution = state.value.resolution
    ? clampStatisticsResolution(state.value.resolution, duration, preset)
    : undefined;
  state.value = normalize({
    ...state.value,
    from: props.period.from,
    to: props.period.to,
    range: preset,
    resolution: nextResolution,
  });
}
function selectResolution(resolution: StatisticsResolution) {
  if (!allowedResolutions.value.has(resolution)) return;
  state.value = normalize({
    ...state.value,
    range: activeRange.value,
    resolution,
  });
}
function selectPrimaryMetric(metric: StatisticsMetric) {
  const current = selectedMetrics.value;
  const next = current.length > 1
    ? [metric, ...current.filter(item => item !== metric)]
    : [metric];
  state.value = normalize({
    ...state.value,
    metric,
    metrics: next.length > 1 ? next : undefined,
  });
}
function toggleMetric(metric: StatisticsMetric) {
  const current = selectedMetrics.value;
  let next: StatisticsMetric[];
  if (current.includes(metric)) {
    if (current.length <= 1) return;
    next = current.filter(item => item !== metric);
  } else {
    next = [...current, metric];
  }
  state.value = normalize({
    ...state.value,
    metric: next[0]!,
    metrics: next.length > 1 ? next : undefined,
  });
}
function reset() {
  state.value = normalize({
    metric: state.value.metric,
    from: props.period.from,
    to: props.period.to,
    label: "",
    contributor: "",
  });
}
</script>
<template>
  <section :id="'statistics-repo-' + repository.id" class="statistics-repository" :data-repository="repository.full_name" :aria-labelledby="'statistics-repository-' + repository.id">
    <header class="statistics-repository-heading"><h2 :id="'statistics-repository-' + repository.id"><a :href="repository.html_url" target="_blank" rel="noopener noreferrer">{{ repository.full_name }}</a></h2></header>
    <div v-if="loading && !data" class="statistics-repository-loading" role="status" aria-live="polite">
      <RefreshCw class="statistics-loading-spinner" :size="26" aria-hidden="true" />
      <div><strong>{{ t("Hämtar och sammanställer statistik") }}</strong><p>{{ t("Vänta medan underlaget för {name} hämtas.", { name: repository.full_name }) }}</p></div>
    </div>
    <p v-else-if="loading" class="statistics-refreshing" role="status" aria-live="polite"><RefreshCw class="statistics-loading-spinner" :size="15" aria-hidden="true" />{{ t("Uppdaterar statistik. Tidigare värden visas under tiden.") }}</p>
    <div class="statistics-repository-content" :aria-busy="loading">
    <div v-if="anyData" class="statistics-filters">
      <div class="statistics-filter-grid">
        <label>{{ t("Från datum (UTC)") }}<input v-model="state.from" type="date" :min="period.from" :max="state.to || period.to" /></label>
        <label>{{ t("Till datum (UTC)") }}<input v-model="state.to" type="date" :min="state.from || period.from" :max="period.to" /></label>
        <label v-if="dimensions.labels.length">{{ t("Nuvarande label") }}<select v-model="state.label"><option value="">{{ t("Alla labels") }}</option><option v-for="name in dimensions.labels" :key="name" :value="name">{{ name }}</option></select></label>
        <label v-if="dimensions.contributors.length">{{ t("Bidragsgivare") }}<select v-model="state.contributor"><option value="">{{ t("Alla bidragsgivare") }}</option><option v-for="name in dimensions.contributors" :key="name" :value="name">{{ name }}</option></select></label>
      </div>
      <div class="statistics-filter-actions"><button class="button small" :disabled="!filtersActive" @click="reset">{{ t("Återställ filter") }}</button></div>
    </div>
    <p v-if="temporary && !loading" role="status" class="notice">{{ anyData ? t("Statistiken kunde inte uppdateras helt. Tidigare hämtade värden visas där de finns. Försök igen senare.") : t("Statistiken kunde inte hämtas just nu. Försök igen senare.") }}</p>
    <p v-if="invalidRange" role="status" class="statistics-message">{{ t("Välj ett giltigt datumintervall inom de senaste 30 dagarna.") }}</p>
    <template v-else-if="anyData">
      <div class="statistics-totals"><div v-for="key in availableMetrics" :key="key" class="statistics-total"><span>{{ t(metricNames[key]) }}</span><strong>{{ number(summary.totals[key]!) }}</strong><small v-if="summary.complete[key] === false">{{ t("Delvis data") }}</small></div><div v-if="summary.closureAgeDays !== null" class="statistics-total"><span>{{ t("Medianålder vid stängning") }}</span><strong>{{ summary.closureAgeDays.toLocaleString(locale, { maximumFractionDigits: 1 }) }} <small>{{ t("dagar") }}</small></strong><small v-if="summary.complete.closed === false">{{ t("Delvis data") }}</small></div></div>
      <section class="statistics-panel">
        <div class="statistics-panel-heading">
          <h3>{{ t("Daglig aktivitet") }}</h3>
          <div class="statistics-chart-selects">
            <label>{{ t("Upplösning") }}<select :value="activeResolution" @change="selectResolution(($event.target as HTMLSelectElement).value as StatisticsResolution)"><option v-for="res in statisticsResolutions" :key="res" :value="res" :disabled="!allowedResolutions.has(res)">{{ t(resolutionNames[res]) }}</option></select></label>
            <label>{{ t("Mätvärde") }}<select :value="state.metric" @change="selectPrimaryMetric(($event.target as HTMLSelectElement).value as StatisticsMetric)"><option v-for="key in availableMetrics" :key="key" :value="key">{{ t(metricNames[key]) }}</option></select></label>
          </div>
        </div>
        <div class="statistics-chart-controls">
          <div class="statistics-range-presets" role="group" :aria-label="t('Tidsintervall')">
            <button v-for="preset in statisticsRanges" :key="preset" type="button" class="button small statistics-range-preset" :class="{ active: activeRange === preset }" :aria-pressed="activeRange === preset" @click="selectRange(preset)">{{ t(rangeNames[preset]) }}</button>
          </div>
          <div class="statistics-metric-chips" role="group" :aria-label="t('Mätvärden i diagrammet')">
            <button v-for="key in availableMetrics" :key="key" type="button" class="button small statistics-metric-chip" :class="{ active: selectedMetrics.includes(key) }" :aria-pressed="selectedMetrics.includes(key)" @click="toggleMetric(key)">{{ t(metricNames[key]) }}</button>
          </div>
        </div>
        <StatisticsChart :series="chartSeries" :metric="state.metric" :title="chartTitle" />
      </section>
      <div class="statistics-breakdowns"><section v-if="summary.totals.commits !== undefined && summary.contributors.length" class="statistics-panel"><h3>{{ t("Bidragsgivare") }}</h3><div class="statistics-table-scroll"><table><caption>{{ t("Commits och kodändringar per författare") }}</caption><thead><tr><th scope="col">{{ t("Författare") }}</th><th scope="col">Commits</th><th v-if="summary.totals.additions !== undefined" scope="col">+ / −</th></tr></thead><tbody><tr v-for="person in summary.contributors" :key="person.name"><th scope="row">{{ person.name || t("Okänd författare") }}</th><td>{{ number(person.commits) }}</td><td v-if="summary.totals.additions !== undefined">+{{ number(person.additions || 0) }} / −{{ number(person.deletions || 0) }}</td></tr></tbody></table></div></section><section v-if="summary.labels.length" class="statistics-panel"><h3>{{ t("Labels på skapade issues") }}</h3><ul class="statistics-labels"><li v-for="item in summary.labels" :key="item.name"><span>{{ item.name }}</span><strong>{{ number(item.count) }}</strong></li></ul></section></div>
      <p v-if="lastFetched" class="statistics-source-time">{{ t("Äldsta underlaget hämtat {time}", { time: new Date(lastFetched).toLocaleString(locale, { timeZone: 'UTC' }) }) }} UTC.</p>
    </template>
    <div v-else-if="!loading && !temporary" class="statistics-empty"><BarChart3 :size="32" /><h3>{{ t("Ingen statistik att visa") }}</h3><p>{{ t("Det finns inget tillgängligt statistikunderlag för urvalet.") }}</p></div>
    </div>
  </section>
</template>
<style scoped>
.statistics-repository { scroll-margin-top: 20px; min-width: 0; margin-bottom: 40px; }
.statistics-repository-heading h2 { margin: 0 0 18px; font-size: 23px; overflow-wrap: anywhere; }
.statistics-repository-heading a { color: inherit; text-decoration: none; }
.statistics-repository-heading a:hover { text-decoration: underline; }
.statistics-filters, .statistics-panel { padding: 20px; border: 1px solid var(--line); background: var(--surface); border-radius: 10px; margin-bottom: 20px; min-width: 0; }
.statistics-filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px; }
.statistics-filter-grid label, .statistics-panel-heading label { display: grid; gap: 6px; font-size: 12px; min-width: 0; }
.statistics-filter-grid input, select { width: 100%; min-width: 0; max-width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: inherit; }
.statistics-filter-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.statistics-message, .statistics-source-time { font-size: 12px; color: var(--muted); }
.statistics-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(155px, 100%), 1fr)); gap: 12px; margin: 20px 0; }
.statistics-total { padding: 15px; border-radius: 8px; background: var(--surface); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.statistics-total > span { color: var(--chart-text); font-size: 12px; }
.statistics-total strong { font-size: 26px; }
.statistics-total small { font-size: 11px; font-weight: 400; color: var(--muted); }
.statistics-panel h3 { font-size: 16px; margin: 0 0 15px; }
.statistics-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.statistics-panel-heading h3 { margin: 0; }
.statistics-chart-selects { display: flex; flex-wrap: wrap; gap: 12px; min-width: 0; }
.statistics-panel-heading label { min-width: 130px; flex: 1 1 130px; }
.statistics-chart-controls { display: grid; gap: 10px; margin-bottom: 14px; min-width: 0; }
.statistics-range-presets, .statistics-metric-chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.statistics-range-preset.active, .statistics-metric-chip.active { border-color: var(--green); background: color-mix(in srgb, var(--green) 16%, var(--surface)); color: var(--text); font-weight: 600; }
.statistics-table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
caption { text-align: left; margin: 0 0 10px; color: var(--muted); }
th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.statistics-breakdowns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 20px; }
.statistics-labels { list-style: none; padding: 0; margin: 0; }
.statistics-labels li { display: flex; gap: 12px; justify-content: space-between; padding: 8px; font-size: 12px; }
.statistics-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.statistics-empty h3 { font-size: 18px; }
.statistics-empty p { font-size: 13px; }
.statistics-repository-loading { display: flex; align-items: center; gap: 16px; min-height: 150px; padding: 25px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.statistics-repository-loading strong { display: block; font-size: 15px; }
.statistics-repository-loading p { margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.statistics-refreshing { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; margin: 0 0 15px; }
.statistics-loading-spinner { flex-shrink: 0; color: var(--green); animation: statistics-spin 1s linear infinite; }
@keyframes statistics-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .statistics-loading-spinner { animation: none; } }
@media (max-width: 650px) { .statistics-panel-heading { flex-direction: column; align-items: stretch; } .statistics-filters, .statistics-panel { padding: 14px; } }
</style>
