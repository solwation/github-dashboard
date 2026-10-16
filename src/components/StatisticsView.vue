<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { RefreshCw, BarChart3 } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Repo } from "../lib/model";
import { demo as demoLanes } from "../lib/demo";
import { StatisticsCollector, statisticsLimits, type StatisticsClient } from "../lib/statistics-client";
import { statisticsDimensions, statisticsMetrics, statisticsWindow, summarizeStatistics, type StatisticsData, type StatisticsMetric } from "../lib/statistics";
import { demoStatistics } from "../lib/statistics-demo";
import StatisticsChart from "./StatisticsChart.vue";
const { t, locale } = useLanguage();
const props = defineProps<{ client: StatisticsClient | null; repositories: Repo[]; demo: boolean; session: number | string }>();
const repositoryList = computed(() => props.demo ? demoLanes().map(lane => lane.repo) : props.repositories);
const selected = ref<string[]>([]);
const period = ref(statisticsWindow());
const from = ref(period.value.from), to = ref(period.value.to), label = ref(""), contributor = ref("");
const metric = ref<StatisticsMetric>("closed");
const snapshots = shallowRef<Record<string, StatisticsData>>({});
const loading = ref(false), loadFailed = ref(false);
let collector: StatisticsCollector | null = null;
let generation = 0;
const metricNames: Record<StatisticsMetric, string> = {
  closed: "Stängda issues", created: "Skapade issues", reopened: "Återöppnade issues", netIssues: "Nettoförändring av issues",
  commits: "Commits", additions: "Tillagda rader", deletions: "Borttagna rader", netLines: "Nettoförändring av kod", files: "Filändringar",
  prsOpened: "Öppnade pull requests", prsMerged: "Mergade pull requests", prsClosed: "Stängda pull requests utan merge",
};
const chosen = computed(() => selected.value.map(name => snapshots.value[name]).filter((value): value is StatisticsData => !!value));
const allReady = computed(() => chosen.value.length === selected.value.length);
const filter = computed(() => ({ from: from.value, to: to.value, label: label.value, contributor: contributor.value }));
const summary = computed(() => summarizeStatistics(chosen.value, filter.value));
const dimensions = computed(() => statisticsDimensions(chosen.value));
const availableMetrics = computed(() => statisticsMetrics.filter(key => summary.value.totals[key] !== undefined));
const anyData = computed(() => availableMetrics.value.length > 0);
const temporary = computed(() => loadFailed.value || chosen.value.some(snapshot => snapshot.temporary.length));
const partial = computed(() => Object.values(summary.value.complete).some(value => value === false));
const rows = computed(() => chosen.value.map(snapshot => ({ name: snapshot.repository, summary: summarizeStatistics([snapshot], filter.value) })));
const chartSeries = computed(() => rows.value.filter(row => row.summary.totals[metric.value] !== undefined).map(row => ({ name: row.name, days: row.summary.days })));
const invalidRange = computed(() => !from.value || !to.value || from.value < period.value.from || to.value > period.value.to || from.value > to.value);
const filtersActive = computed(() => from.value !== period.value.from || to.value !== period.value.to || !!label.value || !!contributor.value || selected.value.length !== 1 || selected.value[0] !== repositoryList.value[0]?.full_name);
const lastFetched = computed(() => chosen.value.length ? Math.min(...chosen.value.flatMap(snapshot => [snapshot.issues, snapshot.events, snapshot.commits, snapshot.changes, snapshot.pulls].filter(value => !!value).map(value => value!.fetchedAt))) : 0);
function number(value: number) { return value.toLocaleString(locale.value); }
function setSelected(name: string, enabled: boolean) {
  if (enabled && selected.value.length < statisticsLimits.repositories) selected.value = [...selected.value, name];
  else if (!enabled) selected.value = selected.value.filter(item => item !== name);
}
function reset() {
  from.value = period.value.from; to.value = period.value.to; label.value = ""; contributor.value = "";
  selected.value = repositoryList.value.slice(0, 1).map(repo => repo.full_name);
}
async function load(force = false) {
  const run = ++generation;
  if (!selected.value.length || (!props.demo && !collector)) { loading.value = false; return; }
  loading.value = true; loadFailed.value = false;
  period.value = statisticsWindow();
  try {
    const data = await Promise.all(selected.value.map(name => props.demo ? Promise.resolve(demoStatistics(name)) : collector!.load(name, Date.now(), force)));
    if (run === generation) snapshots.value = { ...snapshots.value, ...Object.fromEntries(data.map(item => [item.repository, item])) };
  } catch { if (run === generation) loadFailed.value = true; }
  finally { if (run === generation) loading.value = false; }
}
watch([() => props.client, () => props.session, () => props.demo], () => {
  generation++; collector?.dispose(); collector = props.client ? new StatisticsCollector(props.client) : null;
  snapshots.value = {}; period.value = statisticsWindow(); reset();
  void load();
}, { immediate: true });
watch(repositoryList, list => {
  const valid = new Set(list.map(repo => repo.full_name));
  const retained = selected.value.filter(name => valid.has(name));
  if (retained.length !== selected.value.length || (!retained.length && list.length)) selected.value = retained.length ? retained : list.slice(0, 1).map(repo => repo.full_name);
}, { immediate: true });
watch(selected, () => { void load(); });
watch(availableMetrics, keys => { if (!keys.includes(metric.value) && keys.length) metric.value = keys[0]!; });
watch(dimensions, values => { if (label.value && !values.labels.includes(label.value)) label.value = ""; if (contributor.value && !values.contributors.includes(contributor.value)) contributor.value = ""; });
onUnmounted(() => { generation++; collector?.dispose(); });
</script>
<template>
  <section class="statistics-view" :aria-label="t('Statistik')">
    <div class="statistics-heading"><div><span class="eyebrow">{{ t("DITT ARBETE I SIFFROR") }}</span><h1>{{ t("Statistik") }}</h1><p>{{ t("De senaste 30 dagarna, repository för repository.") }}</p></div><button class="button small" :disabled="loading || !selected.length" @click="load(true)"><RefreshCw :size="15" :class="{ spinning: loading }" />{{ t("Uppdatera statistik") }}</button></div>
    <p v-if="demo" class="notice">{{ t("Demostatistiken visar fiktiva data.") }}</p>
    <div class="statistics-filters">
      <fieldset class="repository-selection"><legend>Repositories</legend><p>{{ t("Välj upp till fem repositories för att jämföra.") }}</p><div class="repository-checkboxes"><label v-for="repo in repositoryList" :key="repo.full_name"><input type="checkbox" :checked="selected.includes(repo.full_name)" :disabled="loading || (!selected.includes(repo.full_name) && selected.length >= statisticsLimits.repositories)" @change="setSelected(repo.full_name, ($event.target as HTMLInputElement).checked)" /><span>{{ repo.full_name }}</span></label></div></fieldset>
      <div class="statistics-filter-grid">
        <label>{{ t("Från datum (UTC)") }}<input v-model="from" type="date" :min="period.from" :max="to || period.to" /></label>
        <label>{{ t("Till datum (UTC)") }}<input v-model="to" type="date" :min="from || period.from" :max="period.to" /></label>
        <label v-if="dimensions.labels.length">{{ t("Nuvarande label") }}<select v-model="label"><option value="">{{ t("Alla labels") }}</option><option v-for="name in dimensions.labels" :key="name" :value="name">{{ name }}</option></select></label>
        <label v-if="dimensions.contributors.length">{{ t("Bidragsgivare") }}<select v-model="contributor"><option value="">{{ t("Alla bidragsgivare") }}</option><option v-for="name in dimensions.contributors" :key="name" :value="name">{{ name }}</option></select></label>
      </div>
      <div class="statistics-active-filters"><span>{{ from }} – {{ to }} · UTC · {{ t("{count} repositories valda", { count: selected.length }) }}<template v-if="label"> · {{ label }}</template><template v-if="contributor"> · {{ contributor }}</template></span><button class="button small" :disabled="loading || !filtersActive" @click="reset">{{ t("Återställ filter") }}</button></div>
    </div>
    <p v-if="loading" role="status" class="statistics-message">{{ t("Hämtar statistik…") }}</p>
    <p v-if="temporary" role="status" class="notice">{{ t("Statistiken kunde inte uppdateras helt. Tidigare hämtade värden visas där de finns. Försök igen senare.") }}</p>
    <p v-if="invalidRange" role="status" class="statistics-message">{{ t("Välj ett giltigt datumintervall inom de senaste 30 dagarna.") }}</p>
    <template v-else-if="allReady && anyData">
      <p class="statistics-period">{{ t("Kalenderdagar i UTC. Dagens värden är preliminära.") }}<span v-if="Number.isFinite(lastFetched) && lastFetched"> {{ t("Äldsta underlaget hämtat {time}", { time: new Date(lastFetched).toLocaleString(locale, { timeZone: 'UTC' }) }) }} UTC.</span></p>
      <p v-if="partial" class="statistics-coverage" role="status">{{ t("Delvis data: markerade värden omfattar det underlag som hann hämtas inom sidans gränser. De är inte fullständiga totalsummor.") }}</p>
      <div class="statistics-totals"><div v-for="key in availableMetrics" :key="key" class="statistics-total"><span>{{ t(metricNames[key]) }}</span><strong>{{ number(summary.totals[key]!) }}</strong><small v-if="summary.complete[key] === false">{{ t("Delvis data") }}</small></div><div v-if="summary.closureAgeDays !== null" class="statistics-total"><span>{{ t("Medianålder vid stängning") }}</span><strong>{{ summary.closureAgeDays.toLocaleString(locale, { maximumFractionDigits: 1 }) }} <small>{{ t("dagar") }}</small></strong><small v-if="summary.complete.closed === false">{{ t("Delvis data") }}</small></div></div>
      <section class="statistics-panel"><div class="statistics-panel-heading"><h2>{{ t("Daglig aktivitet") }}</h2><label>{{ t("Mätvärde") }}<select v-model="metric"><option v-for="key in availableMetrics" :key="key" :value="key">{{ t(metricNames[key]) }}</option></select></label></div><StatisticsChart :series="chartSeries" :metric="metric" :title="t(metricNames[metric])" /></section>
      <section class="statistics-panel"><h2>{{ t("Jämför repositories") }}</h2><div class="statistics-table-scroll"><table><caption>{{ t("{metric} per repository", { metric: t(metricNames[metric]) }) }}</caption><thead><tr><th scope="col">Repository</th><th scope="col">{{ t(metricNames[metric]) }}</th></tr></thead><tbody><tr v-for="row in rows.filter(row => row.summary.totals[metric] !== undefined)" :key="row.name"><th scope="row">{{ row.name }}</th><td>{{ number(row.summary.totals[metric]!) }}<small v-if="row.summary.complete[metric] === false"> · {{ t("Delvis data") }}</small></td></tr></tbody></table></div></section>
      <div class="statistics-breakdowns"><section v-if="summary.totals.commits !== undefined && summary.contributors.length" class="statistics-panel"><h2>{{ t("Bidragsgivare") }}</h2><div class="statistics-table-scroll"><table><caption>{{ t("Commits och kodändringar per författare") }}</caption><thead><tr><th scope="col">{{ t("Författare") }}</th><th scope="col">Commits</th><th v-if="summary.totals.additions !== undefined" scope="col">+ / −</th></tr></thead><tbody><tr v-for="person in summary.contributors" :key="person.name"><th scope="row">{{ person.name || t("Okänd författare") }}</th><td>{{ number(person.commits) }}</td><td v-if="summary.totals.additions !== undefined">+{{ number(person.additions || 0) }} / −{{ number(person.deletions || 0) }}</td></tr></tbody></table></div></section><section v-if="summary.labels.length" class="statistics-panel"><h2>{{ t("Labels på skapade issues") }}</h2><ul class="statistics-labels"><li v-for="item in summary.labels" :key="item.name"><span>{{ item.name }}</span><strong>{{ number(item.count) }}</strong></li></ul></section></div>
      <details class="statistics-panel statistics-definitions"><summary>{{ t("Definitioner och datatäckning") }}</summary><ul>
        <li>{{ t("Stängda och återöppnade issues räknas från faktiska GitHub-händelser. Samma issue kan stängas flera gånger. Nettoflöde = skapade + återöppnade − stängda; detta är förändringen, inte antalet öppna issues.") }}</li>
        <li>{{ t("Labels avser dagens labels, även när äldre händelser filtreras. Bidragsgivare avser skaparen för issues och pull requests, aktören för issue-händelser och författaren för commits. Ett labelfilter döljer kodstatistik eftersom commits inte har issue-labels.") }}</li>
        <li>{{ t("Commits följer standardbranchens historik och grupperas efter committer-datum i UTC. Merge-commits räknas som commits men deras diff undantas från kodmåtten för att undvika dubbelräkning. Filändringar är summan av berörda filer per commit, inte unika filer i perioden.") }}</li>
        <li>{{ t("Medianålder vid stängning mäter tiden från skapande till varje stängningshändelse i urvalet, inte aktiv arbetstid. Pull requests räknas separat efter skapande, merge och stängning utan merge.") }}</li>
        <li>{{ t("Per repository hämtas högst 300 uppdaterade issues, 500 issue-händelser, 300 commits och 300 pull requests. Kodmått omfattar högst 60 vanliga commits och 300 filer per commit. Begränsade källor markeras som delvis data. Underlaget återanvänds i fem minuter; Uppdatera hämtar igen.") }}</li>
        <li>{{ t("Vid jämförelse visas kombinerade mätvärden endast när motsvarande underlag finns för alla valda repositories. Byt till ett enskilt repository för dess egna mätvärden.") }}</li>
      </ul></details>
    </template>
    <div v-else-if="!loading && !invalidRange" class="statistics-empty"><BarChart3 :size="32" /><h2>{{ t("Ingen statistik att visa") }}</h2><p>{{ selected.length ? t("Det finns inget tillgängligt statistikunderlag för urvalet.") : t("Välj ett repository för att se statistik.") }}</p></div>
  </section>
</template>
<style scoped>
.statistics-view { width: 100%; min-width: 0; }
.statistics-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 25px; }
.statistics-heading h1 { margin: 6px 0; font-size: 32px; }
.statistics-heading p { margin: 0; color: var(--muted); font-size: 14px; }
.statistics-filters, .statistics-panel { padding: 20px; border: 1px solid var(--line); background: white; border-radius: 10px; margin-bottom: 20px; min-width: 0; }
.repository-selection { border: 0; padding: 0; margin: 0 0 16px; min-width: 0; }
.repository-selection legend { font-weight: 650; font-size: 13px; }
.repository-selection p { color: var(--muted); font-size: 12px; margin: 5px 0 12px; }
.repository-checkboxes { display: flex; flex-wrap: wrap; gap: 8px 18px; max-height: 160px; overflow: auto; }
.repository-checkboxes label { display: flex; align-items: center; gap: 7px; font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
.repository-checkboxes input { accent-color: var(--green); flex-shrink: 0; }
.statistics-filter-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 12px; }
.statistics-filter-grid label, .statistics-panel-heading label { display: grid; gap: 6px; font-size: 12px; min-width: 0; }
.statistics-filter-grid input, select { width: 100%; min-width: 0; max-width: 100%; padding: 8px; border: 1px solid var(--line); border-radius: 5px; background: white; color: inherit; }
.statistics-active-filters { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-top: 15px; font-size: 12px; }
.statistics-active-filters span { overflow-wrap: anywhere; }
.statistics-message, .statistics-period { font-size: 12px; color: var(--muted); }
.statistics-coverage { padding: 12px; border: 1px solid var(--line); font-size: 13px; border-radius: 6px; }
.statistics-totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(155px, 100%), 1fr)); gap: 12px; margin: 20px 0; }
.statistics-total { padding: 15px; border-radius: 8px; background: white; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; }
.statistics-total > span { color: #56696b; font-size: 12px; }
.statistics-total strong { font-size: 26px; }
.statistics-total small { font-size: 11px; font-weight: 400; color: var(--muted); }
.statistics-panel h2 { font-size: 16px; margin: 0 0 15px; }
.statistics-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 15px; }
.statistics-panel-heading label { min-width: 150px; }
.statistics-table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
caption { text-align: left; margin: 0 0 10px; color: var(--muted); }
th, td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
.statistics-breakdowns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 20px; }
.statistics-labels { list-style: none; padding: 0; margin: 0; }
.statistics-labels li { display: flex; gap: 12px; justify-content: space-between; padding: 8px; font-size: 12px; }
.statistics-definitions { font-size: 12px; line-height: 1.7; }
.statistics-definitions summary { cursor: pointer; font-weight: 650; font-size: 14px; }
.statistics-definitions li { margin: 10px 0; }
.statistics-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.statistics-empty h2 { font-size: 18px; }
.statistics-empty p { font-size: 13px; }
@media (max-width: 650px) { .statistics-heading, .statistics-active-filters, .statistics-panel-heading { flex-direction: column; align-items: stretch; } .statistics-heading h1 { font-size: 26px; } .statistics-filters, .statistics-panel { padding: 14px; } }
</style>
