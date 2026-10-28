<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BarChart3, RefreshCw, X } from "@lucide/vue";
import { useRepositoryDisplayName } from "../composables/useRepositoryDisplayName";
import { useLanguage } from "../lib/i18n";
import type { Repo, Rules } from "../lib/model";
import { normalizeStatisticsPreference } from "../lib/statistics-preferences";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, DEFAULT_STATISTICS_RANGE,
  statisticsDimensions, statisticsDurationMs, statisticsMetrics, statisticsRanges, statisticsResolutions, summarizeStatistics,
  type StatisticsData, type StatisticsFilter, type StatisticsMetric, type StatisticsPreference, type StatisticsRangePreset, type StatisticsResolution,
} from "../lib/statistics";
import RepositorySection from "./RepositorySection.vue";
import RepositoryHeading from "./RepositoryHeading.vue";
import StatisticsLoadingProgress from "./StatisticsLoadingProgress.vue";
import { statisticsChartCoverage, type StatisticsLoadStatus } from "../lib/statistics-load-status";
import StatisticsChart from "./StatisticsChart.vue";
import { browserTimeZone } from "../lib/browser-time";
import { activityHeadings, limitChartUnits, seriesColor, seriesDash, statisticsMetricUnit } from "../lib/statistics-chart";
const { t, locale } = useLanguage();
const props = defineProps<{
  repository: Repo;
  /** Combined mode reuses the same totals/metric controls and chart. */
  datasets?: StatisticsData[];
  repositoryFilters?: Record<string, Pick<StatisticsFilter, "label" | "contributor">>;
  allRules?: Record<string, Rules>;
  combined?: boolean;
  filtersOnly?: boolean;
  data: StatisticsData | null;
  loading: boolean;
  loadStatus?: StatisticsLoadStatus;
  loadFailed: boolean;
  period: { from: string; to: string };
  timeSpan: { from: string; to: string; range?: StatisticsRangePreset; resolution: StatisticsResolution };
  preference?: StatisticsPreference;
  collapsed?: boolean;
  /** The repository's label rules, so estimate metrics recognise the same progress label as the board (#280). */
  rules?: Rules;
}>();
const repositoryLabel = useRepositoryDisplayName(() => props.repository.full_name);
const hasOpened = ref(!props.collapsed);
watch(() => props.collapsed, value => { if (!value) hasOpened.value = true; });
const emit = defineEmits<{ "update:preference": [value: StatisticsPreference]; "update:collapsed": [value: boolean] }>();
const metricNames: Record<StatisticsMetric, string> = {
  closed: "Stängda issues", created: "Skapade issues", reopened: "Återöppnade issues", netIssues: "Nettoförändring av issues",
  commits: "Commits", additions: "Tillagda rader", deletions: "Borttagna rader", netLines: "Nettoförändring av kod", files: "Filändringar",
  prsOpened: "Öppnade pull requests", prsMerged: "Mergade pull requests", prsClosed: "Stängda pull requests utan merge",
  timePerPoint: "Tid per SP", estimateDeviation: "Avvikelse från estimat",
};
// Level metrics (#280) carry their unit in the chart legend and a definition for screen readers.
const chartNames: Partial<Record<StatisticsMetric, string>> = { timePerPoint: "Tid per SP (timmar)", estimateDeviation: "Avvikelse från estimat (%)" };
const metricDescriptions: Partial<Record<StatisticsMetric, string>> = {
  timePerPoint: "Estimatets kalibrerade tid per story point vid varje tidpunkt: median av arbetstid per poäng för de senaste stängningarna inom 30 dagar. Kortet visar periodens senaste värde.",
  estimateDeviation: "Median av faktisk tid delat med estimerad tid minus 1 för issues stängda i perioden. Positivt värde betyder att arbetet tog längre tid än estimerat.",
};
// Totals are grouped by subject; each metric card toggles its series in the chart (#170).
const metricGroups: { id: string; title: string; metrics: StatisticsMetric[] }[] = [
  { id: "issues", title: "Issues", metrics: ["created", "closed", "reopened", "netIssues"] },
  { id: "pulls", title: "Pull requests", metrics: ["prsOpened", "prsMerged", "prsClosed"] },
  { id: "code", title: "Kod", metrics: ["commits", "additions", "deletions", "netLines", "files"] },
  { id: "estimates", title: "Estimat", metrics: ["timePerPoint", "estimateDeviation"] },
];
const datasets = computed(() => props.datasets ?? (props.data ? [props.data] : []));
const dimensions = computed(() => statisticsDimensions(datasets.value));
let cachedData: StatisticsData[] | null = null;
const summaryCache = new Map<string, ReturnType<typeof summarizeStatistics>>();
function summarize(filter: StatisticsFilter) {
  const data = datasets.value;
  if (cachedData !== data) { cachedData = data; summaryCache.clear(); }
  const key = JSON.stringify([filter.from, filter.to, filter.label, filter.contributor, filter.range || "", filter.resolution || "", filter.calendar || "", browserTimeZone(), props.rules || {}, props.allRules, props.repositoryFilters]);
  let cached = summaryCache.get(key);
  if (!cached) {
    cached = summarizeStatistics(data, filter, { rules: props.allRules ?? (props.rules ? { [props.repository.full_name]: props.rules } : {}), repositoryFilters: props.repositoryFilters });
    summaryCache.set(key, cached);
  }
  return cached;
}
// Cards and the chart share one time window (dates, range and
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
  const choices = props.data && !props.loading && !props.collapsed ? dimensions.value : undefined;
  const base = {
    ...value,
    from: props.timeSpan.from,
    to: props.timeSpan.to,
    range: props.timeSpan.range,
    resolution: props.timeSpan.resolution,
  };
  const normalized = normalizeStatisticsPreference(base, props.period, choices);
  if (props.data && !props.loading && !props.collapsed) {
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
const temporary = computed(() => props.loadFailed || datasets.value.some(data => !!data.temporary.length));
const selectedMetrics = computed<StatisticsMetric[]>(() => {
  const raw = state.value.metrics?.length ? state.value.metrics : [state.value.metric];
  const valid = raw.filter(key => availableMetrics.value.includes(key));
  // A left and a right axis fit two units; a stored older selection keeps its newest two (#283).
  return valid.length ? limitChartUnits(valid, statisticsMetricUnit).kept : availableMetrics.value.slice(0, 1);
});
/** Metrics just taken out of the chart because a third unit was chosen, announced next to the chart (#283). */
const replacedMetrics = ref<StatisticsMetric[]>([]);
const replacedText = computed(() => replacedMetrics.value.length
  ? t("Diagrammet visar högst två enheter åt gången, så {metrics} togs bort.", { metrics: replacedMetrics.value.map(metric => t(metricNames[metric])).join(", ") })
  : "");
const chartSeries = computed(() => {
  if (!props.data) return [];
  const metrics = selectedMetrics.value;
  if (!metrics.length) return [];
  if (metrics.length === 1) {
    const metric = metrics[0]!;
    return summary.value.totals[metric] !== undefined
      ? [{ name: t(chartNames[metric] ?? metricNames[metric]), metric, days: summary.value.days, format: (value: number) => display(metric, value) }]
      : [];
  }
  return metrics.map(metric => ({
    name: t(chartNames[metric] ?? metricNames[metric]),
    metric,
    days: summary.value.days,
    format: (value: number) => display(metric, value),
  }));
});
const incompleteMetrics = computed(() => selectedMetrics.value.filter(metric => summary.value.complete[metric] === false).map(metric => t(metricNames[metric])).join(", "));
const chartCoverage = computed(() => props.loading ? statisticsChartCoverage(props.loadStatus, selectedMetrics.value, props.timeSpan.from, props.timeSpan.to) : null);
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
const showFilters = computed(() => !props.combined && !!props.data && (dimensions.value.labels.length > 0 || dimensions.value.contributors.length > 0));
const lastFetched = computed(() => {
  const values = datasets.value.flatMap(data => [data.issues, data.events, data.commits, data.changes, data.pulls].filter(value => !!value).map(value => value!.fetchedAt));
  return values.length ? Math.min(...values) : 0;
});
function number(value: number) { return value.toLocaleString(locale.value); }
/** Card and chart text: hours per point as min/h, deviation as a signed percentage (measured 0 % stays). */
function display(metric: StatisticsMetric, value: number) {
  if (metric === "timePerPoint") return value < 1
    ? t("{value} min", { value: Math.max(1, Math.round(value * 60)).toLocaleString(locale.value) })
    : t("{value} h", { value: value.toLocaleString(locale.value, { maximumFractionDigits: 1 }) });
  if (metric === "estimateDeviation") return (value / 100).toLocaleString(locale.value, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 });
  return number(value);
}
function descriptionId(key: StatisticsMetric) { return metricDescriptions[key] ? "statistics-metric-" + props.repository.id + "-" + key : undefined; }
function publish(value: StatisticsPreference) {
  if (JSON.stringify(value) !== JSON.stringify(props.preference)) emit("update:preference", { ...value });
}
watch([() => props.preference, () => props.data, () => props.period, () => props.timeSpan, () => props.loading, () => props.datasets, () => props.repositoryFilters, () => props.allRules], () => {
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
    const limited = limitChartUnits([...current, metric], statisticsMetricUnit);
    next = limited.kept;
    replacedMetrics.value = limited.removed;
  }
  if (!next.includes(metric)) replacedMetrics.value = [];
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
  <RepositorySection v-if="filtersOnly ? showFilters : (!combined || loading || anyData || temporary)" :id="'statistics-repo-' + repository.id" class="statistics-repository" :collapsed="collapsed" heading-class="statistics-repository-heading" :data-repository="repository.full_name" :aria-labelledby="'statistics-repository-' + repository.id">
    <template #header>
      <div v-if="combined" class="statistics-combined-heading"><h2 :id="'statistics-repository-' + repository.id">{{ t("Alla valda repositories") }}</h2></div>
      <div v-else-if="filtersOnly" class="statistics-combined-heading"><h2 :id="'statistics-repository-' + repository.id"><a :href="repository.html_url" :title="repository.full_name" :aria-label="repository.full_name" target="_blank" rel="noopener noreferrer">{{ repositoryLabel }}</a></h2></div>
      <RepositoryHeading v-else :repository="repository" :collapsed="collapsed" :label="repositoryLabel"
        :controls="'statistics-repository-body-' + repository.id" :heading-id="'statistics-repository-' + repository.id"
        toggle-class="statistics-repository-toggle" @toggle="emit('update:collapsed', !collapsed)" />
      <div v-if="showFilters" class="statistics-repo-filters" role="group" :aria-label="t('Filter för {name}', { name: repository.full_name })">
        <select v-if="dimensions.labels.length" v-model="state.label" class="statistics-filter-select" :class="{ active: state.label }" :aria-label="t('Nuvarande label')"><option value="">{{ t("Alla labels") }}</option><option v-for="name in dimensions.labels" :key="name" :value="name">{{ name }}</option></select>
        <select v-if="dimensions.contributors.length" v-model="state.contributor" class="statistics-filter-select statistics-contributor-select" :class="{ active: state.contributor }" :aria-label="t('Bidragsgivare')"><option value="">{{ t("Alla bidragsgivare") }}</option><option v-for="name in dimensions.contributors" :key="name" :value="name">{{ name }}</option></select>
      </div>
    </template>
    <div v-show="!collapsed" :id="'statistics-repository-body-' + repository.id" class="statistics-repository-body">
    <template v-if="hasOpened">
    <StatisticsLoadingProgress v-if="!filtersOnly && loading && loadStatus" :status="loadStatus" />
    <div v-if="showFilters && filtersActive" class="statistics-filter-chips">
      <button v-if="state.label" type="button" class="statistics-filter-chip" :aria-label="t('Ta bort filter {filter}', { filter: t('Label: {name}', { name: state.label }) })" @click="clearFilter('label')">{{ t("Label: {name}", { name: state.label }) }}<X :size="12" aria-hidden="true" /></button>
      <button v-if="state.contributor" type="button" class="statistics-filter-chip" :aria-label="t('Ta bort filter {filter}', { filter: t('Bidragsgivare: {name}', { name: state.contributor }) })" @click="clearFilter('contributor')">{{ t("Bidragsgivare: {name}", { name: state.contributor }) }}<X :size="12" aria-hidden="true" /></button>
      <button type="button" class="statistics-filter-clear" @click="clearFilters">{{ t("Rensa filter") }}</button>
    </div>
    <template v-if="!filtersOnly">
    <div v-if="loading && !data" class="statistics-repository-loading" role="status" aria-live="polite">
      <RefreshCw class="statistics-loading-spinner" :size="26" aria-hidden="true" />
      <div><strong>{{ t("Hämtar och sammanställer statistik") }}</strong><p>{{ t("Vänta medan underlaget för {name} hämtas.", { name: repository.full_name }) }}</p></div>
    </div>
    <div class="statistics-repository-content" :aria-busy="loading">
    <p v-if="temporary && !loading" role="status" class="notice">{{ anyData ? t("Statistiken kunde inte uppdateras helt. Tidigare hämtade värden visas där de finns. Försök igen senare.") : t("Statistiken kunde inte hämtas just nu. Försök igen senare.") }}</p>
    <template v-if="anyData">
      <div class="statistics-totals" role="group" :aria-label="t('Mätvärden i diagrammet')" :aria-describedby="'statistics-metrics-hint-' + repository.id">
        <p :id="'statistics-metrics-hint-' + repository.id" class="sr-only">{{ t("Välj vilka mätvärden som visas i diagrammet. Minst ett mätvärde är alltid valt.") }} {{ t("Högst två enheter visas samtidigt, med var sin axel.") }}</p>
        <section v-for="group in visibleGroups" :key="group.id" class="statistics-total-group" :aria-labelledby="'statistics-group-' + repository.id + '-' + group.id">
          <h3 :id="'statistics-group-' + repository.id + '-' + group.id">{{ t(group.title) }}</h3>
          <div class="statistics-total-grid">
            <button v-for="key in group.metrics" :key="key" type="button" class="statistics-total statistics-total-toggle" :class="{ selected: seriesIndex(key) >= 0 }" :aria-pressed="seriesIndex(key) >= 0" :aria-describedby="descriptionId(key)" :data-metric="key" :data-series-index="seriesIndex(key) >= 0 ? seriesIndex(key) : undefined" :style="metricStyle(key)" @click="toggleMetric(key)">
              <span class="statistics-total-label">{{ t(metricNames[key]) }}</span>
              <span class="statistics-total-value"><strong>{{ display(key, summary.totals[key]!) }}</strong><span v-if="summary.complete[key] === false" class="statistics-partial" :title="t('Delvis data')"><span aria-hidden="true">≈</span><span class="sr-only">{{ t("Delvis data") }}</span></span><svg v-if="seriesIndex(key) >= 0" class="statistics-total-swatch" width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" :stroke-dasharray="seriesDash(seriesIndex(key))" /></svg></span>
            </button>
            <div v-if="group.closureAge && summary.closureAgeDays !== null" class="statistics-total statistics-total-static">
              <span class="statistics-total-label">{{ t("Medianålder vid stängning") }}</span>
              <span class="statistics-total-value"><strong>{{ summary.closureAgeDays.toLocaleString(locale, { maximumFractionDigits: 1 }) }} <small>{{ t("dagar") }}</small></strong><span v-if="summary.complete.closed === false" class="statistics-partial" :title="t('Delvis data')"><span aria-hidden="true">≈</span><span class="sr-only">{{ t("Delvis data") }}</span></span></span>
            </div>
          </div>
          <template v-for="key in group.metrics" :key="key"><p v-if="metricDescriptions[key]" :id="descriptionId(key)" hidden>{{ t(metricDescriptions[key]!) }}</p></template>
        </section>
      </div>
      <section class="statistics-panel">
        <div class="statistics-panel-heading">
          <h3>{{ t(activityHeadings[timeSpan.resolution]) }}</h3>
        </div>
        <p v-if="incompleteMetrics" role="status" class="statistics-message">{{ t("Delvis underlag för {metrics}. Aktivitet i den valda perioden kan saknas.", { metrics: incompleteMetrics }) }}</p>
        <p role="status" class="statistics-unit-message" :class="{ empty: !replacedText }">{{ replacedText }}</p>
        <StatisticsChart :series="chartSeries" :metric="state.metric" :title="chartTitle" :resolution="timeSpan.resolution" :coverage="chartCoverage" />
      </section>
      <p v-if="lastFetched" class="statistics-source-time">{{ t("Äldsta underlaget hämtat {time}", { time: new Date(lastFetched).toLocaleString(locale) }) }}.</p>
    </template>
    <div v-else-if="!loading && !temporary" class="statistics-empty"><BarChart3 :size="32" /><h3>{{ t("Ingen statistik att visa") }}</h3><p>{{ t("Det finns inget tillgängligt statistikunderlag för urvalet.") }}</p></div>
    </div>
    </template>
    </template>
    </div>
  </RepositorySection>
</template>
<style scoped>
.statistics-repository { min-width: 0; }
.statistics-combined-heading { min-width: 0; }
.statistics-combined-heading h2 { margin: 0; font-size: 14px; line-height: 1.5; }
.statistics-combined-heading a { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.statistics-repository-body:empty { display: none; }
.statistics-repository :deep(.statistics-repository-heading) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 29rem); gap: 8px 16px; }
.statistics-repository :deep(.lane-title:only-child) { grid-column: 1 / -1; }
.statistics-repository-body { padding: var(--space-3); min-width: 0; }
.statistics-repo-filters { width: 29rem; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; min-width: 0; max-width: 100%; }
.statistics-filter-select { min-width: 0; max-width: 100%; width: 100%; text-overflow: ellipsis; padding: 5px 8px; font: inherit; font-size: 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: inherit; }
.statistics-contributor-select { grid-column: 2; }
.statistics-filter-select.active { border-color: var(--green); }
.statistics-filter-select:focus-visible, .statistics-filter-chip:focus-visible, .statistics-filter-clear:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.statistics-filter-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: -4px 0 12px; }
.statistics-filter-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 3px 8px 3px 10px; border: 1px solid color-mix(in srgb, var(--green) 45%, var(--line)); border-radius: 999px; background: color-mix(in srgb, var(--green) 10%, var(--surface)); color: inherit; font: inherit; font-size: 12px; cursor: pointer; overflow-wrap: anywhere; text-align: left; }
.statistics-filter-chip:hover { border-color: var(--green); }
.statistics-filter-clear { padding: 3px 6px; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px; text-decoration: underline; cursor: pointer; }
.statistics-filter-clear:hover { color: inherit; }
.statistics-panel { padding: var(--space-3); border: 1px solid var(--line); background: var(--surface); border-radius: 10px; margin-bottom: var(--space-3); min-width: 0; }
.statistics-message, .statistics-unit-message, .statistics-source-time { font-size: 12px; color: var(--muted); }
/* The live region stays in the DOM so the replacement is announced, but takes no space while empty. */
.statistics-unit-message.empty { margin: 0; }
.statistics-totals { display: grid; gap: var(--space-2); margin: 0 0 var(--space-2); min-width: 0; }
.statistics-total-group { display: grid; grid-template-columns: 5rem minmax(0, 1fr); align-items: center; gap: var(--space-2); min-width: 0; }
.statistics-total-group h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--muted); }
.statistics-total-grid { display: flex; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
.statistics-total { min-width: 0; min-height: 44px; flex: 1 1 8rem; padding: var(--space-1) var(--space-2); border-radius: 7px; background: var(--surface); border: 1px solid var(--line); border-left-width: 4px; display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); text-align: left; font: inherit; color: inherit; }
.statistics-total-toggle { cursor: pointer; }
.statistics-total-toggle:hover { border-color: var(--muted); }
.statistics-total-toggle:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.statistics-total-toggle.selected { border-color: color-mix(in srgb, var(--metric-color) 45%, var(--line)); border-left-color: var(--metric-color); background: color-mix(in srgb, var(--metric-color) 11%, var(--surface)); }
.statistics-total-static { border-left-color: var(--line); background: transparent; }
.statistics-total-label { min-width: 0; flex: 1; color: var(--chart-text); font-size: 12px; line-height: 1.3; overflow-wrap: anywhere; }
.statistics-total-value { display: flex; align-items: baseline; gap: var(--space-1); flex-shrink: 0; min-width: 0; }
.statistics-total strong { font-size: 19px; line-height: 1.2; }
.statistics-total small { font-size: 11px; font-weight: 400; color: var(--muted); }
.statistics-partial { font-size: 12px; color: var(--muted); cursor: help; }
.statistics-total-swatch { width: 16px; align-self: center; flex-shrink: 0; }
.statistics-total-swatch line { stroke: var(--metric-color); stroke-width: 3; stroke-linecap: round; }
.statistics-panel h3 { font-size: 16px; margin: 0 0 15px; }
.statistics-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-1); flex-wrap: wrap; }
.statistics-panel-heading h3 { margin: 0; }
.statistics-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.statistics-empty h3 { font-size: 18px; }
.statistics-empty p { font-size: 13px; }
.statistics-repository-loading { display: flex; align-items: center; gap: 16px; min-height: 150px; padding: 25px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
.statistics-repository-loading strong { display: block; font-size: 15px; }
.statistics-repository-loading p { margin: 7px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.statistics-loading-spinner { flex-shrink: 0; color: var(--green); animation: statistics-spin 1s linear infinite; }
@keyframes statistics-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .statistics-loading-spinner { animation: none; } }
@media (max-width: 650px) {
  .statistics-repository { margin-bottom: 12px; }
  .statistics-repository-body { padding: 10px 12px; }
  .statistics-panel-heading { flex-direction: column; align-items: stretch; margin-bottom: 8px; }
  .statistics-panel { padding: 10px 12px; margin-bottom: 8px; border-radius: 8px; }
  .statistics-totals { gap: 8px; margin-bottom: 8px; }
  .statistics-total-group { display: block; }
  .statistics-total-group h3 { margin-bottom: var(--space-1); }
  .statistics-total-grid { gap: var(--space-2); }
  .statistics-total { padding: var(--space-1) var(--space-2); border-left-width: 3px; }
  .statistics-total-label { font-size: 11px; }
  .statistics-total strong { font-size: 16px; }
  .statistics-source-time { margin: 2px 0 0; }
}
/* Rail-sized desktops give long metric labels enough width instead of breaking words. */
@media (min-width: 651px) and (max-width: 1100px) {
  .statistics-total { flex-basis: calc((100% - var(--space-4)) / 3); }
}
@media (max-width: 850px) {
  .statistics-repository :deep(.statistics-repository-heading) { grid-template-columns: minmax(0, 1fr); }
}
</style>
