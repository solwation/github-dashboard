<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BarChart3, ChevronDown, ChevronRight, RefreshCw, X } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Repo } from "../lib/model";
import { normalizeStatisticsPreference } from "../lib/statistics-preferences";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, DEFAULT_STATISTICS_RANGE,
  statisticsDimensions, statisticsDurationMs, statisticsMetrics, statisticsRanges, statisticsResolutions, summarizeStatistics,
  type StatisticsData, type StatisticsFilter, type StatisticsMetric, type StatisticsPreference, type StatisticsRangePreset, type StatisticsResolution,
} from "../lib/statistics";
import StatisticsChart from "./StatisticsChart.vue";
import { browserTimeZone } from "../lib/browser-time";
import { activityHeadings, seriesColor, seriesDash } from "../lib/statistics-chart";
const { t, locale } = useLanguage();
const props = defineProps<{
  repository: Repo;
  data: StatisticsData | null;
  loading: boolean;
  loadFailed: boolean;
  period: { from: string; to: string };
  timeSpan: { from: string; to: string; range?: StatisticsRangePreset; resolution: StatisticsResolution };
  preference?: StatisticsPreference;
  collapsed?: boolean;
}>();
const emit = defineEmits<{ "update:preference": [value: StatisticsPreference]; "update:collapsed": [value: boolean] }>();
const metricNames: Record<StatisticsMetric, string> = {
  closed: "Stängda issues", created: "Skapade issues", reopened: "Återöppnade issues", netIssues: "Nettoförändring av issues",
  commits: "Commits", additions: "Tillagda rader", deletions: "Borttagna rader", netLines: "Nettoförändring av kod", files: "Filändringar",
  prsOpened: "Öppnade pull requests", prsMerged: "Mergade pull requests", prsClosed: "Stängda pull requests utan merge",
};
// Totals are grouped by subject; each metric card toggles its series in the chart (#170).
const metricGroups: { id: string; title: string; metrics: StatisticsMetric[] }[] = [
  { id: "issues", title: "Issues", metrics: ["created", "closed", "reopened", "netIssues"] },
  { id: "pulls", title: "Pull requests", metrics: ["prsOpened", "prsMerged", "prsClosed"] },
  { id: "code", title: "Kod", metrics: ["commits", "additions", "deletions", "netLines", "files"] },
];
const datasets = computed(() => props.data ? [props.data] : []);
const dimensions = computed(() => statisticsDimensions(datasets.value));
let cachedData: StatisticsData[] | null = null;
const summaryCache = new Map<string, ReturnType<typeof summarizeStatistics>>();
function summarize(filter: StatisticsFilter) {
  const data = datasets.value;
  if (cachedData !== data) { cachedData = data; summaryCache.clear(); }
  const key = JSON.stringify([filter.from, filter.to, filter.label, filter.contributor, filter.range || "", filter.resolution || "", filter.calendar || "", browserTimeZone()]);
  let cached = summaryCache.get(key);
  if (!cached) {
    cached = summarizeStatistics(data, filter);
    summaryCache.set(key, cached);
  }
  return cached;
}
// Cards, breakdowns and the chart share one time window (dates, range and
// resolution), so each total equals the sum of the chart's points (#167).
function windowFilter(label: string, contributor: string): StatisticsFilter {
  return {
    from: props.timeSpan.from,
    to: props.timeSpan.to,
    label,
    contributor,
    range: props.timeSpan.range,
    resolution: props.timeSpan.resolution,
    calendar: "local",
  };
}
function normalize(value: StatisticsPreference | undefined) {
  const choices = props.data && !props.loading ? dimensions.value : undefined;
  const base = {
    ...value,
    from: props.timeSpan.from,
    to: props.timeSpan.to,
    range: props.timeSpan.range,
    resolution: props.timeSpan.resolution,
  };
  const normalized = normalizeStatisticsPreference(base, props.period, choices);
  if (props.data && !props.loading) {
    const totals = summarize(windowFilter(normalized.label, normalized.contributor)).totals;
    const metrics = statisticsMetrics.filter(key => totals[key] !== undefined);
    return normalizeStatisticsPreference(normalized, props.period, { ...dimensions.value, metrics });
  }
  return normalized;
}
const state = ref<StatisticsPreference>(normalize(props.preference));
const summary = computed(() => summarize(windowFilter(state.value.label, state.value.contributor)));
const availableMetrics = computed(() => statisticsMetrics.filter(key => summary.value.totals[key] !== undefined));
const anyData = computed(() => availableMetrics.value.length > 0);
const temporary = computed(() => props.loadFailed || !!props.data?.temporary.length);
const selectedMetrics = computed<StatisticsMetric[]>(() => {
  const raw = state.value.metrics?.length ? state.value.metrics : [state.value.metric];
  const valid = raw.filter(key => availableMetrics.value.includes(key));
  return valid.length ? valid : availableMetrics.value.slice(0, 1);
});
const chartSeries = computed(() => {
  if (!props.data) return [];
  const metrics = selectedMetrics.value;
  if (!metrics.length) return [];
  if (metrics.length === 1) {
    const metric = metrics[0]!;
    return summary.value.totals[metric] !== undefined
      ? [{ name: t(metricNames[metric]), metric, days: summary.value.days }]
      : [];
  }
  return metrics.map(metric => ({
    name: t(metricNames[metric]),
    metric,
    days: summary.value.days,
  }));
});
const incompleteMetrics = computed(() => selectedMetrics.value.filter(metric => summary.value.complete[metric] === false).map(metric => t(metricNames[metric])).join(", "));
const chartTitle = computed(() =>
  selectedMetrics.value.map(metric => t(metricNames[metric])).join(", ") || t(metricNames[state.value.metric]),
);
const visibleGroups = computed(() => metricGroups
  .map(group => ({ ...group, metrics: group.metrics.filter(key => availableMetrics.value.includes(key)), closureAge: group.id === "issues" && summary.value.closureAgeDays !== null }))
  .filter(group => group.metrics.length || group.closureAge));
/** Series position of a metric in the chart (same order as chartSeries), or -1 when not shown. */
function seriesIndex(metric: StatisticsMetric) { return chartSeries.value.findIndex(series => series.metric === metric); }
function metricStyle(metric: StatisticsMetric) {
  const index = seriesIndex(metric);
  return index >= 0 ? { "--metric-color": seriesColor(index) } : undefined;
}
// Only label/contributor count as filters; the selected chart metrics are not (#172).
const filtersActive = computed(() => !!state.value.label || !!state.value.contributor);
const showFilters = computed(() => !!props.data && (dimensions.value.labels.length > 0 || dimensions.value.contributors.length > 0));
// Each optional breakdown starts closed; reopening a repository preserves the user's toggles.
const breakdownOpen = ref({ contributors: false, labels: false });
function syncOpen(key: "contributors" | "labels", event: Event) { breakdownOpen.value[key] = (event.target as HTMLDetailsElement).open; }
const lastFetched = computed(() => {
  const values = props.data ? [props.data.issues, props.data.events, props.data.commits, props.data.changes, props.data.pulls].filter(value => !!value).map(value => value!.fetchedAt) : [];
  return values.length ? Math.min(...values) : 0;
});
function number(value: number) { return value.toLocaleString(locale.value); }
function publish(value: StatisticsPreference) {
  if (JSON.stringify(value) !== JSON.stringify(props.preference)) emit("update:preference", { ...value });
}
watch([() => props.preference, () => props.data, () => props.period, () => props.timeSpan, () => props.loading], () => {
  const normalized = normalize(props.preference);
  if (JSON.stringify(state.value) !== JSON.stringify(normalized)) state.value = normalized;
  publish(normalized);
}, { immediate: true, deep: true });
watch(state, value => {
  const normalized = normalize(value);
  if (JSON.stringify(value) !== JSON.stringify(normalized)) state.value = normalized;
  publish(normalized);
}, { deep: true });
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
function clearFilter(key: "label" | "contributor") {
  state.value = normalize({ ...state.value, [key]: "" });
}
function clearFilters() {
  state.value = normalize({ ...state.value, label: "", contributor: "" });
}
</script>
<template>
  <section :id="'statistics-repo-' + repository.id" class="statistics-repository" :data-repository="repository.full_name" :aria-labelledby="'statistics-repository-' + repository.id">
    <header class="statistics-repository-heading">
      <div class="statistics-repository-identity">
        <button type="button" class="statistics-repository-toggle" :aria-expanded="!collapsed" :aria-controls="'statistics-repository-body-' + repository.id" :aria-label="t(collapsed ? 'Expandera {name}' : 'Kollapsa {name}', { name: repository.full_name })" @click="emit('update:collapsed', !collapsed)"><ChevronRight v-if="collapsed" :size="20" aria-hidden="true" /><ChevronDown v-else :size="20" aria-hidden="true" /></button>
        <h2 :id="'statistics-repository-' + repository.id"><a :href="repository.html_url" target="_blank" rel="noopener noreferrer">{{ repository.full_name }}</a></h2>
      </div>
      <div v-if="showFilters" class="statistics-repo-filters" role="group" :aria-label="t('Filter för {name}', { name: repository.full_name })">
        <select v-if="dimensions.labels.length" v-model="state.label" class="statistics-filter-select" :class="{ active: state.label }" :aria-label="t('Nuvarande label')"><option value="">{{ t("Alla labels") }}</option><option v-for="name in dimensions.labels" :key="name" :value="name">{{ name }}</option></select>
        <select v-if="dimensions.contributors.length" v-model="state.contributor" class="statistics-filter-select" :class="{ active: state.contributor }" :aria-label="t('Bidragsgivare')"><option value="">{{ t("Alla bidragsgivare") }}</option><option v-for="name in dimensions.contributors" :key="name" :value="name">{{ name }}</option></select>
      </div>
    </header>
    <div v-show="!collapsed" :id="'statistics-repository-body-' + repository.id" class="statistics-repository-body">
    <div v-if="showFilters && filtersActive" class="statistics-filter-chips">
      <button v-if="state.label" type="button" class="statistics-filter-chip" :aria-label="t('Ta bort filter {filter}', { filter: t('Label: {name}', { name: state.label }) })" @click="clearFilter('label')">{{ t("Label: {name}", { name: state.label }) }}<X :size="13" aria-hidden="true" /></button>
      <button v-if="state.contributor" type="button" class="statistics-filter-chip" :aria-label="t('Ta bort filter {filter}', { filter: t('Bidragsgivare: {name}', { name: state.contributor }) })" @click="clearFilter('contributor')">{{ t("Bidragsgivare: {name}", { name: state.contributor }) }}<X :size="13" aria-hidden="true" /></button>
      <button type="button" class="statistics-filter-clear" @click="clearFilters">{{ t("Rensa filter") }}</button>
    </div>
    <div v-if="loading && !data" class="statistics-repository-loading" role="status" aria-live="polite">
      <RefreshCw class="statistics-loading-spinner" :size="26" aria-hidden="true" />
      <div><strong>{{ t("Hämtar och sammanställer statistik") }}</strong><p>{{ t("Vänta medan underlaget för {name} hämtas.", { name: repository.full_name }) }}</p></div>
    </div>
    <p v-else-if="loading" class="statistics-refreshing" role="status" aria-live="polite"><RefreshCw class="statistics-loading-spinner" :size="15" aria-hidden="true" />{{ t("Hämtar statistik. Värden och diagram uppdateras löpande.") }}</p>
    <div class="statistics-repository-content" :aria-busy="loading">
    <p v-if="temporary && !loading" role="status" class="notice">{{ anyData ? t("Statistiken kunde inte uppdateras helt. Tidigare hämtade värden visas där de finns. Försök igen senare.") : t("Statistiken kunde inte hämtas just nu. Försök igen senare.") }}</p>
    <template v-if="anyData">
      <div class="statistics-totals" role="group" :aria-label="t('Mätvärden i diagrammet')" :aria-describedby="'statistics-metrics-hint-' + repository.id">
        <p :id="'statistics-metrics-hint-' + repository.id" class="sr-only">{{ t("Välj vilka mätvärden som visas i diagrammet. Minst ett mätvärde är alltid valt.") }}</p>
        <section v-for="group in visibleGroups" :key="group.id" class="statistics-total-group" :aria-labelledby="'statistics-group-' + repository.id + '-' + group.id">
          <h3 :id="'statistics-group-' + repository.id + '-' + group.id">{{ t(group.title) }}</h3>
          <div class="statistics-total-grid">
            <button v-for="key in group.metrics" :key="key" type="button" class="statistics-total statistics-total-toggle" :class="{ selected: seriesIndex(key) >= 0 }" :aria-pressed="seriesIndex(key) >= 0" :data-metric="key" :data-series-index="seriesIndex(key) >= 0 ? seriesIndex(key) : undefined" :style="metricStyle(key)" @click="toggleMetric(key)">
              <span class="statistics-total-label">{{ t(metricNames[key]) }}</span>
              <span class="statistics-total-value"><strong>{{ number(summary.totals[key]!) }}</strong><span v-if="summary.complete[key] === false" class="statistics-partial" :title="t('Delvis data')"><span aria-hidden="true">≈</span><span class="sr-only">{{ t("Delvis data") }}</span></span><svg v-if="seriesIndex(key) >= 0" class="statistics-total-swatch" width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" :stroke-dasharray="seriesDash(seriesIndex(key))" /></svg></span>
            </button>
            <div v-if="group.closureAge && summary.closureAgeDays !== null" class="statistics-total statistics-total-static">
              <span class="statistics-total-label">{{ t("Medianålder vid stängning") }}</span>
              <span class="statistics-total-value"><strong>{{ summary.closureAgeDays.toLocaleString(locale, { maximumFractionDigits: 1 }) }} <small>{{ t("dagar") }}</small></strong><span v-if="summary.complete.closed === false" class="statistics-partial" :title="t('Delvis data')"><span aria-hidden="true">≈</span><span class="sr-only">{{ t("Delvis data") }}</span></span></span>
            </div>
          </div>
        </section>
      </div>
      <section class="statistics-panel">
        <div class="statistics-panel-heading">
          <h3>{{ t(activityHeadings[timeSpan.resolution]) }}</h3>
        </div>
        <p v-if="incompleteMetrics" role="status" class="statistics-message">{{ t("Delvis underlag för {metrics}. Aktivitet i den valda perioden kan saknas.", { metrics: incompleteMetrics }) }}</p>
        <StatisticsChart :series="chartSeries" :metric="state.metric" :title="chartTitle" :resolution="timeSpan.resolution" />
      </section>
      <div class="statistics-breakdowns"><details v-if="summary.totals.commits !== undefined && summary.contributors.length" class="statistics-panel statistics-breakdown" :open="breakdownOpen.contributors" @toggle="syncOpen('contributors', $event)"><summary><h3>{{ t("Bidragsgivare") }}</h3></summary><div class="statistics-table-scroll"><table><caption>{{ t("Commits och kodändringar per författare") }}</caption><thead><tr><th scope="col">{{ t("Författare") }}</th><th scope="col">Commits</th><th v-if="summary.totals.additions !== undefined" scope="col">+ / −</th></tr></thead><tbody><tr v-for="person in summary.contributors" :key="person.name"><th scope="row">{{ person.name || t("Okänd författare") }}</th><td>{{ number(person.commits) }}</td><td v-if="summary.totals.additions !== undefined">+{{ number(person.additions || 0) }} / −{{ number(person.deletions || 0) }}</td></tr></tbody></table></div></details><details v-if="summary.labels.length" class="statistics-panel statistics-breakdown" :open="breakdownOpen.labels" @toggle="syncOpen('labels', $event)"><summary><h3>{{ t("Labels på skapade issues") }}</h3></summary><ul class="statistics-labels"><li v-for="item in summary.labels" :key="item.name"><span>{{ item.name }}</span><strong>{{ number(item.count) }}</strong></li></ul></details></div>
      <p v-if="lastFetched" class="statistics-source-time">{{ t("Äldsta underlaget hämtat {time}", { time: new Date(lastFetched).toLocaleString(locale) }) }}.</p>
    </template>
    <div v-else-if="!loading && !temporary" class="statistics-empty"><BarChart3 :size="32" /><h3>{{ t("Ingen statistik att visa") }}</h3><p>{{ t("Det finns inget tillgängligt statistikunderlag för urvalet.") }}</p></div>
    </div>
    </div>
  </section>
</template>
<style scoped>
.statistics-repository { scroll-margin-top: 20px; min-width: 0; margin-bottom: 32px; padding-top: 18px; border-top: 1px solid var(--line); }
.statistics-repository-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 12px; min-width: 0; }
.statistics-repository-identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.statistics-repository-toggle { display: inline-grid; place-items: center; flex-shrink: 0; width: 32px; height: 32px; padding: 4px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); cursor: pointer; }
.statistics-repository-toggle:hover { background: var(--surface); color: var(--text); }
.statistics-repository-toggle:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.statistics-repository-heading h2 { margin: 0; font-size: 23px; overflow-wrap: anywhere; min-width: 0; }
.statistics-repository-heading a { color: inherit; text-decoration: none; }
.statistics-repository-heading a:hover { text-decoration: underline; }
.statistics-repo-filters { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; max-width: 100%; }
.statistics-filter-select { min-width: 0; max-width: 100%; width: auto; padding: 5px 8px; font: inherit; font-size: 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: inherit; }
.statistics-filter-select.active { border-color: var(--green); }
.statistics-filter-select:focus-visible, .statistics-filter-chip:focus-visible, .statistics-filter-clear:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.statistics-filter-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: -4px 0 12px; }
.statistics-filter-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 8px 3px 10px; border: 1px solid color-mix(in srgb, var(--green) 45%, var(--line)); border-radius: 999px; background: color-mix(in srgb, var(--green) 10%, var(--surface)); color: inherit; font: inherit; font-size: 12px; cursor: pointer; overflow-wrap: anywhere; text-align: left; }
.statistics-filter-chip:hover { border-color: var(--green); }
.statistics-filter-clear { padding: 3px 6px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
.statistics-filter-clear:hover { color: inherit; }
.statistics-panel { padding: 20px; border: 1px solid var(--line); background: var(--surface); border-radius: 10px; margin-bottom: 20px; min-width: 0; }
.statistics-message, .statistics-source-time { font-size: 12px; color: var(--muted); }
.statistics-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 14px 18px; margin: 0 0 20px; min-width: 0; }
.statistics-total-group { min-width: 0; }
.statistics-total-group h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
.statistics-total-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(120px, 100%), 1fr)); gap: 8px; }
.statistics-total { min-width: 0; padding: 8px 10px; border-radius: 7px; background: var(--surface); border: 1px solid var(--line); border-left-width: 4px; display: flex; flex-direction: column; justify-content: space-between; gap: 2px; text-align: left; font: inherit; color: inherit; }
.statistics-total-toggle { cursor: pointer; }
.statistics-total-toggle:hover { border-color: var(--muted); }
.statistics-total-toggle:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.statistics-total-toggle.selected { border-color: color-mix(in srgb, var(--metric-color) 45%, var(--line)); border-left-color: var(--metric-color); background: color-mix(in srgb, var(--metric-color) 11%, var(--surface)); }
.statistics-total-static { border-left-color: var(--line); background: transparent; }
.statistics-total-label { color: var(--chart-text); font-size: 12px; line-height: 1.3; overflow-wrap: anywhere; }
.statistics-total-value { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.statistics-total strong { font-size: 19px; line-height: 1.2; }
.statistics-total small { font-size: 11px; font-weight: 400; color: var(--muted); }
.statistics-partial { font-size: 12px; color: var(--muted); cursor: help; }
.statistics-total-swatch { margin-left: auto; align-self: center; flex-shrink: 0; }
.statistics-total-swatch line { stroke: var(--metric-color); stroke-width: 3; stroke-linecap: round; }
.statistics-panel h3 { font-size: 16px; margin: 0 0 15px; }
.statistics-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
.statistics-panel-heading h3 { margin: 0; }
.statistics-table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
caption { text-align: left; margin: 0 0 10px; color: var(--muted); }
th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.statistics-breakdowns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 0 20px; align-items: start; }
.statistics-breakdown > summary { display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none; border-radius: 5px; }
.statistics-breakdown > summary::-webkit-details-marker { display: none; }
.statistics-breakdown > summary::before { content: ""; width: 7px; height: 7px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(-45deg); transition: transform .15s ease; flex-shrink: 0; }
.statistics-breakdown[open] > summary::before { transform: rotate(45deg); }
.statistics-breakdown > summary:focus-visible { outline: 2px solid var(--green); outline-offset: 4px; }
.statistics-breakdown > summary h3 { margin: 0; }
.statistics-breakdown[open] > summary { margin-bottom: 15px; }
@media (prefers-reduced-motion: reduce) { .statistics-breakdown > summary::before { transition: none; } }
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
@media (max-width: 650px) {
  .statistics-repository { margin-bottom: 12px; padding-top: 12px; }
  .statistics-repository-heading { margin-bottom: 10px; }
  .statistics-repository-heading h2 { font-size: 19px; }
  .statistics-panel-heading { flex-direction: column; align-items: stretch; margin-bottom: 8px; }
  .statistics-panel { padding: 10px 12px; margin-bottom: 8px; border-radius: 8px; }
  .statistics-totals { gap: 8px; margin-bottom: 8px; }
  .statistics-total-group h3 { margin-bottom: 4px; }
  .statistics-total-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .statistics-total { padding: 5px 8px; border-left-width: 3px; }
  .statistics-total-label { font-size: 11px; }
  .statistics-total strong { font-size: 16px; }
  /* Collapsed breakdowns sit side by side; an opened one takes the full row. */
  .statistics-breakdowns { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 8px; }
  .statistics-breakdown { padding: 8px 10px; margin-bottom: 8px; }
  .statistics-breakdown[open] { grid-column: 1 / -1; }
  .statistics-breakdown > summary { min-height: 24px; }
  .statistics-breakdown[open] > summary { margin-bottom: 10px; }
  .statistics-breakdown > summary h3 { font-size: 14px; line-height: 1.25; overflow-wrap: anywhere; }
  .statistics-source-time { margin: 2px 0 0; }
}
@media (min-width: 360px) and (max-width: 650px) { .statistics-total-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
</style>
