<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { RefreshCw, BarChart3 } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Repo } from "../lib/model";
import { StatisticsCollector, type StatisticsClient } from "../lib/statistics-client";
import { statisticsWindow, type StatisticsData, type StatisticsPreference, type StatisticsPreferences } from "../lib/statistics";
import { demoStatistics } from "../lib/statistics-demo";
import StatisticsRepository from "./StatisticsRepository.vue";
const { t } = useLanguage();
const props = defineProps<{ client: StatisticsClient | null; repositories: Repo[]; demo: boolean; session: number | string; preferences?: StatisticsPreferences }>();
const emit = defineEmits<{ "update:preferences": [value: StatisticsPreferences] }>();
const period = ref(statisticsWindow());
const preferencesState = ref<StatisticsPreferences>({ ...props.preferences });
const snapshots = shallowRef<Record<string, StatisticsData>>({});
const loading = ref<Record<string, boolean>>({});
const failures = ref<Record<string, boolean>>({});
const busy = computed(() => props.repositories.some(repo => loading.value[repo.full_name]));
const initialLoading = computed(() => busy.value && !props.repositories.some(repo => {
  const data = snapshots.value[repo.full_name];
  return data && [data.issues, data.events, data.commits, data.changes, data.pulls].some(source => source !== null);
}));
const completed = computed(() => props.repositories.filter(repo => loading.value[repo.full_name] === false).length);
const partial = computed(() => props.repositories.some(repo => {
  const data = snapshots.value[repo.full_name];
  return !!data && ([data.issues, data.events, data.commits, data.changes, data.pulls].some(source => source?.complete === false) || !!data.changes?.data.some(change => !change.filesComplete));
}));
let collector: StatisticsCollector | null = null;
let generation = 0;
function updatePreference(repository: string, value: StatisticsPreference) {
  if (JSON.stringify(preferencesState.value[repository]) === JSON.stringify(value)) return;
  preferencesState.value = { ...preferencesState.value, [repository]: value };
  emit("update:preferences", { ...preferencesState.value });
}
watch(() => props.preferences, value => {
  if (value && JSON.stringify(value) !== JSON.stringify(preferencesState.value)) preferencesState.value = { ...value };
}, { deep: true });
async function load(force = false) {
  const run = ++generation;
  const names = props.repositories.map(repo => repo.full_name);
  const selected = new Set(names);
  snapshots.value = Object.fromEntries(Object.entries(snapshots.value).filter(([name]) => selected.has(name)));
  if (!names.length || (!props.demo && !collector)) { loading.value = {}; return; }
  period.value = statisticsWindow();
  loading.value = Object.fromEntries(names.map(name => [name, true]));
  failures.value = {};
  // One collector owns the semaphore for every section on this page.
  await Promise.all(names.map(async name => {
    try {
      const data = props.demo ? demoStatistics(name) : await collector!.load(name, Date.now(), force);
      if (run === generation) snapshots.value = { ...snapshots.value, [name]: data };
    } catch { if (run === generation) failures.value = { ...failures.value, [name]: true }; }
    finally { if (run === generation) loading.value = { ...loading.value, [name]: false }; }
  }));
}
watch([() => props.client, () => props.session, () => props.demo], () => {
  generation++; collector?.dispose(); collector = props.client ? new StatisticsCollector(props.client) : null;
  snapshots.value = {}; period.value = statisticsWindow();
  void load();
}, { immediate: true });
watch(() => props.repositories.map(repo => repo.full_name).join("\n"), () => { void load(); });
onUnmounted(() => { generation++; collector?.dispose(); });
</script>
<template>
  <section class="statistics-view" :aria-label="t('Statistik')">
    <div class="statistics-heading"><div><span class="eyebrow">{{ t("DITT ARBETE I SIFFROR") }}</span><h1>{{ t("Statistik") }}</h1><p>{{ t("De senaste 30 dagarna, repository för repository.") }}</p></div><button class="button small" :disabled="busy || !repositories.length" @click="load(true)"><RefreshCw :size="15" :class="{ spinning: busy }" />{{ t("Uppdatera statistik") }}</button></div>
    <p v-if="demo" class="notice">{{ t("Demostatistiken visar fiktiva data.") }}</p>
    <div v-if="initialLoading" class="statistics-loading-splash" role="status" aria-live="polite">
      <RefreshCw class="statistics-loading-spinner" :size="34" aria-hidden="true" />
      <h2>{{ t("Hämtar och sammanställer statistik") }}</h2>
      <p>{{ t("Vi hämtar underlaget från GitHub. Statistiken visas så snart den är klar.") }}</p>
      <small>{{ t("Hämtning avslutad för {done} av {total} repositories.", { done: completed, total: repositories.length }) }}</small>
    </div>
    <div v-show="!initialLoading" class="statistics-repositories">
      <StatisticsRepository v-for="repository in repositories" :key="repository.full_name" :repository="repository"
        :data="snapshots[repository.full_name] || null" :loading="!!loading[repository.full_name]" :load-failed="!!failures[repository.full_name]"
        :period="period" :preference="preferencesState[repository.full_name]" @update:preference="updatePreference(repository.full_name, $event)" />
    </div>
    <div v-if="!repositories.length" class="statistics-empty"><BarChart3 :size="32" /><h2>{{ t("Ingen statistik att visa") }}</h2><p>{{ t("Välj repositories i översikten för att se deras statistik.") }}</p></div>
    <footer v-if="repositories.length && !initialLoading" class="statistics-footnotes">
      <p>{{ t("Kalenderdagar i UTC. Dagens värden är preliminära.") }}</p>
      <details class="statistics-panel statistics-definitions"><summary>{{ t("Definitioner och datatäckning") }}</summary><ul>
        <li>{{ t("Stängda och återöppnade issues räknas från faktiska GitHub-händelser. Samma issue kan stängas flera gånger. Nettoflöde = skapade + återöppnade − stängda; detta är förändringen, inte antalet öppna issues.") }}</li>
        <li>{{ t("Labels avser dagens labels, även när äldre händelser filtreras. Bidragsgivare avser skaparen för issues och pull requests, aktören för issue-händelser och författaren för commits. Ett labelfilter döljer kodstatistik eftersom commits inte har issue-labels.") }}</li>
        <li>{{ t("Commits följer standardbranchens historik och grupperas efter committer-datum i UTC. Merge-commits räknas som commits men deras diff undantas från kodmåtten för att undvika dubbelräkning. Filändringar är summan av berörda filer per commit, inte unika filer i perioden.") }}</li>
        <li>{{ t("Medianålder vid stängning mäter tiden från skapande till varje stängningshändelse i urvalet, inte aktiv arbetstid. Pull requests räknas separat efter skapande, merge och stängning utan merge.") }}</li>
        <li>{{ t("Per repository hämtas högst 300 uppdaterade issues, 500 issue-händelser, 300 commits och 300 pull requests. Kodmått omfattar högst 60 vanliga commits och 300 filer per commit. Begränsade källor markeras som delvis data. Underlaget återanvänds i fem minuter; Uppdatera hämtar igen.") }}</li>
      </ul></details>
      <p v-if="partial" class="statistics-coverage">{{ t("Delvis data: markerade värden omfattar det underlag som hann hämtas inom sidans gränser. De är inte fullständiga totalsummor.") }}</p>
    </footer>
  </section>
</template>
<style scoped>
.statistics-view { width: 100%; min-width: 0; }
.statistics-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 25px; }
.statistics-heading h1 { margin: 6px 0; font-size: 32px; }
.statistics-heading p { margin: 0; color: var(--muted); font-size: 14px; }
.statistics-footnotes { border-top: 1px solid var(--line); padding-top: 16px; color: var(--muted); font-size: 12px; line-height: 1.7; }
.statistics-footnotes p { margin: 0 0 12px; }
.statistics-definitions summary { cursor: pointer; font-weight: 600; }
.statistics-definitions li { margin: 10px 0; }
.statistics-coverage { margin-top: 18px !important; }
.statistics-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.statistics-empty h2 { font-size: 18px; }
.statistics-empty p { font-size: 13px; }
.statistics-loading-splash { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 300px; padding: 36px 20px; border: 1px solid var(--line); border-radius: 12px; background: white; text-align: center; }
.statistics-loading-splash h2 { margin: 0; font-size: 21px; }
.statistics-loading-splash p { max-width: 420px; margin: 0; color: var(--muted); font-size: 14px; line-height: 1.6; }
.statistics-loading-splash small { margin-top: 6px; color: var(--muted); font-size: 12px; }
.statistics-loading-spinner { color: var(--green); animation: statistics-spin 1s linear infinite; }
@keyframes statistics-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .statistics-loading-spinner { animation: none; } }
@media (max-width: 650px) { .statistics-heading { flex-direction: column; align-items: stretch; } .statistics-heading h1 { font-size: 26px; } }
</style>
