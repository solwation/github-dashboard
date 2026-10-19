<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { RefreshCw, BarChart3 } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Repo } from "../lib/model";
import { StatisticsCollector, type StatisticsClient } from "../lib/statistics-client";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, DEFAULT_STATISTICS_RANGE, formatStatisticsBound, hasStatisticsTime,
  parseStatisticsBound, rangeNames, resolutionNames, statisticsDurationMs, statisticsPresetWindow, statisticsRangeMs, statisticsRanges,
  statisticsResolutions, statisticsWindow, statisticsWindowMs, validStatisticsBound, type StatisticsData, type StatisticsPreference,
  type StatisticsPreferences, type StatisticsRangePreset, type StatisticsResolution,
} from "../lib/statistics";
import { readStatisticsCache, writeStatisticsCache } from "../lib/statistics-cache";
import { demoStatistics } from "../lib/statistics-demo";
import StatisticsRepository from "./StatisticsRepository.vue";
const { t, locale } = useLanguage();
const props = defineProps<{ client: StatisticsClient | null; repositories: Repo[]; demo: boolean; session: number | string; preferences?: StatisticsPreferences; credential?: string }>();
const emit = defineEmits<{ "update:preferences": [value: StatisticsPreferences] }>();
const period = ref(statisticsWindow());
const preferencesState = ref<StatisticsPreferences>({ ...props.preferences });

// #169: the global window is always concrete UTC "YYYY-MM-DDTHH:mm" bounds shown in
// the pickers. A preset recomputes its window from now; undefined range = custom.
const periodBounds = computed(() => ({
  start: parseStatisticsBound(period.value.from, "start"),
  end: parseStatisticsBound(period.value.to, "end"),
}));
const pickerMin = computed(() => formatStatisticsBound(periodBounds.value.start));
const pickerMax = computed(() => formatStatisticsBound(periodBounds.value.end));
function presetWindow(preset: StatisticsRangePreset, resolution?: StatisticsResolution) {
  return statisticsPresetWindow(preset, Date.now(), period.value, resolution);
}
const initialWindow = presetWindow(DEFAULT_STATISTICS_RANGE);
const globalFrom = ref(initialWindow.from);
const globalTo = ref(initialWindow.to);
const globalRange = ref<StatisticsRangePreset | undefined>(DEFAULT_STATISTICS_RANGE);
const globalResolution = ref<StatisticsResolution | undefined>(undefined);

function applyPreset(preset: StatisticsRangePreset, resolution?: StatisticsResolution) {
  const clamped = resolution ? clampStatisticsResolution(resolution, statisticsRangeMs[preset], preset) : undefined;
  const window = presetWindow(preset, clamped);
  globalFrom.value = window.from;
  globalTo.value = window.to;
  globalRange.value = preset;
  globalResolution.value = clamped;
}
/** Converts a saved bound (legacy date-only or datetime) to a datetime picker value. */
function pickerValue(value: string, edge: "start" | "end") {
  if (hasStatisticsTime(value)) return value;
  const ms = parseStatisticsBound(value, edge);
  return Number.isFinite(ms) ? formatStatisticsBound(ms) : "";
}
/** Keeps a custom window inside the fetched period; false when nothing valid remains. */
function clampCustomWindow() {
  const { start, end } = statisticsWindowMs({ from: globalFrom.value, to: globalTo.value });
  if (!Number.isFinite(start)) return false;
  const from = Math.max(start, periodBounds.value.start), to = Math.min(end, periodBounds.value.end);
  if (from >= to) return false;
  globalFrom.value = formatStatisticsBound(from);
  globalTo.value = formatStatisticsBound(to);
  return true;
}

function syncFromPreferences(prefs?: StatisticsPreferences) {
  if (!prefs) return;
  for (const repo of props.repositories) {
    const pref = prefs[repo.full_name];
    if (!pref) continue;
    if (pref.range) {
      // A preset always restores as a fresh window ending now, also for legacy date-only saves.
      applyPreset(pref.range, pref.resolution);
      return;
    }
    if (pref.from && pref.to && (hasStatisticsTime(pref.from) || hasStatisticsTime(pref.to) || pref.from !== period.value.from || pref.to !== period.value.to)) {
      globalFrom.value = pickerValue(pref.from, "start");
      globalTo.value = pickerValue(pref.to, "end");
      globalRange.value = undefined;
      if (!clampCustomWindow()) { applyPreset(DEFAULT_STATISTICS_RANGE, pref.resolution); return; }
      globalResolution.value = pref.resolution
        ? clampStatisticsResolution(pref.resolution, statisticsDurationMs({ from: globalFrom.value, to: globalTo.value }))
        : undefined;
      return;
    }
  }
}
syncFromPreferences(props.preferences);

const activeRange = computed<StatisticsRangePreset | undefined>(() => globalRange.value);
const invalidRange = computed(() => {
  if (!hasStatisticsTime(globalFrom.value) || !hasStatisticsTime(globalTo.value)) return true;
  if (!validStatisticsBound(globalFrom.value) || !validStatisticsBound(globalTo.value)) return true;
  const { start, end } = statisticsWindowMs({ from: globalFrom.value, to: globalTo.value });
  return !Number.isFinite(start) || start < periodBounds.value.start || end > periodBounds.value.end;
});
const chartDurationMs = computed(() =>
  statisticsDurationMs({ from: globalFrom.value, to: globalTo.value, range: activeRange.value }),
);
const allowedResolutions = computed(() => new Set(allowedStatisticsResolutions(chartDurationMs.value)));
const activeResolution = computed<StatisticsResolution>(() =>
  clampStatisticsResolution(globalResolution.value, chartDurationMs.value, activeRange.value),
);

const timeSpan = computed(() => ({
  from: globalFrom.value,
  to: globalTo.value,
  range: activeRange.value,
  resolution: activeResolution.value,
}));
const boundFormat = computed(() => new Intl.DateTimeFormat(locale.value, {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC",
}));
const periodText = computed(() => {
  if (invalidRange.value) return "";
  const { start, end } = statisticsWindowMs({ from: globalFrom.value, to: globalTo.value });
  return `${boundFormat.value.format(start)} – ${boundFormat.value.format(end)}`;
});
const periodLabel = computed(() => periodText.value
  ? t("Visar {period} UTC · upplösning {resolution}", { period: periodText.value, resolution: t(resolutionNames[activeResolution.value]) })
  : "");
const subtitle = computed(() => periodText.value
  ? t("{period} UTC, repository för repository.", { period: periodText.value })
  : t("Repository för repository."));
const resettable = computed(() => activeRange.value !== DEFAULT_STATISTICS_RANGE || !!globalResolution.value);

function applyGlobalTimeSpan() {
  if (invalidRange.value) return;
  const updated: StatisticsPreferences = {};
  for (const repo of props.repositories) {
    const current = preferencesState.value[repo.full_name] || {
      from: globalFrom.value,
      to: globalTo.value,
      label: "",
      contributor: "",
      metric: "closed",
    };
    updated[repo.full_name] = {
      ...current,
      from: globalFrom.value,
      to: globalTo.value,
      range: activeRange.value,
      resolution: activeResolution.value,
    };
  }
  preferencesState.value = { ...preferencesState.value, ...updated };
  emit("update:preferences", { ...preferencesState.value });
}

function selectRange(preset: StatisticsRangePreset) {
  applyPreset(preset, globalResolution.value);
  applyGlobalTimeSpan();
}

const fromInput = ref<HTMLInputElement | null>(null);
function selectCustom() {
  // Keeps the shown window but detaches it from the preset, then moves focus to the pickers.
  if (globalRange.value) {
    globalRange.value = undefined;
    applyGlobalTimeSpan();
  }
  fromInput.value?.focus();
}

function selectResolution(resolution: StatisticsResolution) {
  if (!allowedResolutions.value.has(resolution)) return;
  if (globalRange.value) applyPreset(globalRange.value, resolution);
  else globalResolution.value = resolution;
  applyGlobalTimeSpan();
}

function setBounds(from: string, to: string) {
  globalFrom.value = from;
  globalTo.value = to;
  globalRange.value = undefined;
  if (globalResolution.value && !invalidRange.value) {
    globalResolution.value = clampStatisticsResolution(globalResolution.value, statisticsDurationMs({ from, to }));
  }
  applyGlobalTimeSpan();
}

function resetTimeSpan() {
  applyPreset(DEFAULT_STATISTICS_RANGE);
  applyGlobalTimeSpan();
}

const snapshots = shallowRef<Record<string, StatisticsData>>({});
const preparedRepositories = ref(new Set<string>());
const renderedRepositories = computed(() => props.repositories.filter(repo => preparedRepositories.value.has(repo.full_name)));
const loading = ref<Record<string, boolean>>({});
const cacheFailed = ref(false);
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
const historyVerifiedAt = computed(() => {
  const values = props.repositories.map(repo => snapshots.value[repo.full_name]?.commits).filter(source => source?.historyVerifiedAt && source.historyVerifiedAt < source.fetchedAt).map(source => source!.historyVerifiedAt!);
  return values.length ? Math.min(...values) : null;
});
let followedAnchor = "";
async function followRepositoryAnchor() {
  const hash = window.location.hash;
  if (!/^#statistics-repo-\d+$/.test(hash) || followedAnchor === hash || initialLoading.value) return;
  await nextTick();
  const target = document.getElementById(hash.slice(1));
  if (!target?.getClientRects().length) return;
  target.scrollIntoView({ block: "start" });
  followedAnchor = hash;
}
watch([initialLoading, renderedRepositories], () => { void followRepositoryAnchor(); }, { flush: "post" });
onMounted(() => { window.addEventListener("hashchange", followRepositoryAnchor); void followRepositoryAnchor(); });
let collector: StatisticsCollector | null = null;
let generation = 0;
let sessionEpoch = 0;
let restoration: Promise<void> = Promise.resolve();
function updatePreference(repository: string, value: StatisticsPreference) {
  const merged: StatisticsPreference = {
    ...value,
    from: globalFrom.value,
    to: globalTo.value,
    range: activeRange.value,
    resolution: activeResolution.value,
  };
  if (JSON.stringify(preferencesState.value[repository]) === JSON.stringify(merged)) return;
  preferencesState.value = { ...preferencesState.value, [repository]: merged };
  emit("update:preferences", { ...preferencesState.value });
}
watch(() => props.preferences, value => {
  if (value && JSON.stringify(value) !== JSON.stringify(preferencesState.value)) {
    preferencesState.value = { ...value };
    syncFromPreferences(value);
  }
}, { deep: true });
async function load(force = false) {
  const run = ++generation;
  const epoch = sessionEpoch, activeCollector = collector, token = props.credential;
  const names = props.repositories.map(repo => repo.full_name);
  const selected = new Set(names);
  snapshots.value = Object.fromEntries(Object.entries(snapshots.value).filter(([name]) => selected.has(name)));
  if (!names.length || (!props.demo && !collector)) { loading.value = {}; preparedRepositories.value = new Set(); return; }
  period.value = statisticsWindow();
  // #169: a preset follows the clock on every reload; a custom window is kept (clamped to the period).
  const previous = `${globalFrom.value}|${globalTo.value}|${globalRange.value}`;
  if (globalRange.value) applyPreset(globalRange.value, globalResolution.value);
  else if (!invalidRange.value && !clampCustomWindow()) applyPreset(DEFAULT_STATISTICS_RANGE, globalResolution.value);
  if (previous !== `${globalFrom.value}|${globalTo.value}|${globalRange.value}`) applyGlobalTimeSpan();
  for (const name of names) {
    const data = activeCollector?.cached(name);
    if (!snapshots.value[name] && data) snapshots.value = { ...snapshots.value, [name]: data };
  }
  preparedRepositories.value = new Set(names);
  loading.value = Object.fromEntries(names.map(name => [name, true]));
  failures.value = {};
  // One collector owns the semaphore for every section on this page.
  await Promise.all(names.map(async name => {
    try {
      const data = props.demo ? demoStatistics(name) : await activeCollector!.load(name, Date.now(), force);
      if (run === generation) snapshots.value = { ...snapshots.value, [name]: data };
      if (epoch === sessionEpoch && activeCollector && token && !props.demo) {
        try { await writeStatisticsCache(token, activeCollector.export()); if (epoch === sessionEpoch) cacheFailed.value = false; }
        catch { if (epoch === sessionEpoch) cacheFailed.value = true; }
      }
    } catch { if (run === generation) failures.value = { ...failures.value, [name]: true }; }
    finally { if (run === generation) loading.value = { ...loading.value, [name]: false }; }
  }));
}
watch([() => props.client, () => props.session, () => props.demo, () => props.credential], () => {
  generation++; const epoch = ++sessionEpoch;
  collector?.dispose(); collector = props.client ? new StatisticsCollector(props.client) : null;
  const activeCollector = collector, token = props.credential;
  snapshots.value = {}; preparedRepositories.value = new Set(); period.value = statisticsWindow(); cacheFailed.value = false;
  loading.value = Object.fromEntries(props.repositories.map(repo => [repo.full_name, true]));
  restoration = (async () => {
    const saved = token && !props.demo ? await readStatisticsCache(token) : [];
    if (epoch !== sessionEpoch || activeCollector !== collector) return;
    activeCollector?.restore(saved);
    const restored: Record<string, StatisticsData> = {};
    for (const repo of props.repositories) {
      const data = activeCollector?.cached(repo.full_name);
      if (data) restored[repo.full_name] = data;
    }
    snapshots.value = restored;
  })();
  void restoration.then(() => { if (epoch === sessionEpoch) return load(); });
}, { immediate: true });
watch(() => props.repositories.map(repo => repo.full_name).join("\n"), () => {
  const epoch = sessionEpoch;
  const selected = new Set(props.repositories.map(repo => repo.full_name));
  preparedRepositories.value = new Set([...preparedRepositories.value].filter(name => selected.has(name)));
  void restoration.then(() => { if (epoch === sessionEpoch) return load(); });
});
onUnmounted(() => { generation++; sessionEpoch++; collector?.dispose(); window.removeEventListener("hashchange", followRepositoryAnchor); });
</script>
<template>
  <section class="statistics-view" :aria-label="t('Statistik')">
    <div class="statistics-heading"><div><span class="eyebrow">{{ t("DITT ARBETE I SIFFROR") }}</span><h1>{{ t("Statistik") }}</h1><p class="statistics-subtitle">{{ subtitle }}</p></div><button class="button small" :disabled="busy || !repositories.length" @click="load(true)"><RefreshCw :size="15" :class="{ spinning: busy }" />{{ t("Uppdatera statistik") }}</button></div>
    <div v-if="repositories.length && !initialLoading" class="statistics-time-controls" role="region" :aria-label="t('Tidsintervall')">
      <div class="statistics-time-presets">
        <div class="statistics-range-presets" role="group" :aria-label="t('Tidsintervall')">
          <button v-for="preset in statisticsRanges" :key="preset" type="button" class="button small statistics-range-preset"
            :class="{ active: activeRange === preset }" :aria-pressed="activeRange === preset"
            @click="selectRange(preset)">{{ t(rangeNames[preset]) }}</button>
          <button type="button" class="button small statistics-range-preset statistics-range-custom"
            :class="{ active: !activeRange }" :aria-pressed="!activeRange" @click="selectCustom">{{ t("Anpassat") }}</button>
        </div>
        <div class="statistics-resolution-select">
          <label>{{ t("Upplösning") }}
            <select :value="activeResolution" @change="selectResolution(($event.target as HTMLSelectElement).value as StatisticsResolution)">
              <option v-for="res in statisticsResolutions" :key="res" :value="res" :disabled="!allowedResolutions.has(res)">{{ t(resolutionNames[res]) }}</option>
            </select>
          </label>
        </div>
      </div>
      <div class="statistics-time-dates">
        <label>{{ t("Från (UTC)") }}<input ref="fromInput" :value="globalFrom" type="datetime-local" step="60" :min="pickerMin" :max="pickerMax" @change="setBounds(($event.target as HTMLInputElement).value, globalTo)" /></label>
        <label>{{ t("Till (UTC)") }}<input :value="globalTo" type="datetime-local" step="60" :min="pickerMin" :max="pickerMax" @change="setBounds(globalFrom, ($event.target as HTMLInputElement).value)" /></label>
        <button v-if="resettable" type="button" class="button small" @click="resetTimeSpan">{{ t("Återställ period") }}</button>
      </div>
      <p v-if="periodLabel" class="statistics-period-label" aria-live="polite">{{ periodLabel }}</p>
    </div>
    <p v-if="cacheFailed" class="notice" role="status">{{ t("Statistiken kunde inte sparas på enheten. De hämtade graferna kan fortfarande användas.") }}</p>
    <p v-if="demo" class="notice">{{ t("Demostatistiken visar fiktiva data.") }}</p>
    <p v-if="invalidRange" role="status" class="statistics-message">{{ t("Välj ett giltigt datumintervall inom de senaste 30 dagarna.") }}</p>
    <div v-if="initialLoading" class="statistics-loading-splash" role="status" aria-live="polite">
      <RefreshCw class="statistics-loading-spinner" :size="34" aria-hidden="true" />
      <h2>{{ t("Hämtar och sammanställer statistik") }}</h2>
      <p>{{ t("Vi hämtar underlaget från GitHub. Statistiken visas så snart den är klar.") }}</p>
      <small>{{ t("Hämtning avslutad för {done} av {total} repositories.", { done: completed, total: repositories.length }) }}</small>
    </div>
    <div v-show="!initialLoading && !invalidRange" class="statistics-repositories">
      <StatisticsRepository v-for="repository in renderedRepositories" :key="repository.full_name" :repository="repository"
        :data="snapshots[repository.full_name] || null" :loading="!!loading[repository.full_name]" :load-failed="!!failures[repository.full_name]"
        :period="period" :time-span="timeSpan" :preference="preferencesState[repository.full_name]" @update:preference="updatePreference(repository.full_name, $event)" />
    </div>
    <div v-if="!repositories.length" class="statistics-empty"><BarChart3 :size="32" /><h2>{{ t("Ingen statistik att visa") }}</h2><p>{{ t("Välj repositories i översikten för att se deras statistik.") }}</p></div>
    <footer v-if="repositories.length && !initialLoading" class="statistics-footnotes">
      <p>{{ t("Kalenderdagar i UTC. Dagens värden är preliminära.") }}</p>
      <details class="statistics-panel statistics-definitions"><summary>{{ t("Definitioner och datatäckning") }}</summary><ul>
        <li>{{ t("Stängda och återöppnade issues räknas från faktiska GitHub-händelser. Samma issue kan stängas flera gånger. Nettoflöde = skapade + återöppnade − stängda; detta är förändringen, inte antalet öppna issues.") }}</li>
        <li>{{ t("Labels avser dagens labels, även när äldre händelser filtreras. Bidragsgivare avser skaparen för issues och pull requests, aktören för issue-händelser och författaren för commits. Ett labelfilter döljer kodstatistik eftersom commits inte har issue-labels.") }}</li>
        <li>{{ t("Commits följer standardbranchens historik och grupperas efter committer-datum i UTC. Merge-commits räknas som commits men deras diff undantas från kodmåtten för att undvika dubbelräkning. Filändringar är summan av berörda filer per commit, inte unika filer i perioden.") }}</li>
        <li>{{ t("Medianålder vid stängning mäter tiden från skapande till varje stängningshändelse i urvalet, inte aktiv arbetstid. Pull requests räknas separat efter skapande, merge och stängning utan merge.") }}</li>
        <li>{{ t("Per repository hämtas högst 300 uppdaterade issues, 500 issue-händelser, 300 commits och 300 pull requests. Kodmått omfattar högst 60 vanliga commits och 300 filer per commit. Begränsade källor markeras som delvis data. Underlaget återanvänds i fem minuter; Uppdatera omvaliderar hela perioden.") }}</li>
        <li>{{ t("Statistik sparas krypterat för högst tio repositories i sju dagar, upp till 8 MiB. Issues, händelser och pull requests omvalideras alltid. Commithistorik återanvänds med överlapp från föregående sista UTC-dag, och omvalideras helt minst var sjunde dag eller vid Uppdatera. SHA-bundna kodmått återanvänds. Återanvända källdata kan innehålla högst 600 commits; ofullständig täckning markeras som delvis data.") }}</li>
      </ul></details>
      <p v-if="historyVerifiedAt">{{ t("Äldsta omvalideringen av återanvänd commithistorik: {time} UTC.", { time: new Date(historyVerifiedAt).toLocaleString(locale, { timeZone: 'UTC' }) }) }}</p>
      <p v-if="partial" class="statistics-coverage">{{ t("Delvis data: markerade värden omfattar det underlag som hann hämtas inom sidans gränser. De är inte fullständiga totalsummor.") }}</p>
    </footer>
  </section>
</template>
<style scoped>
.statistics-view { width: 100%; min-width: 0; }
.statistics-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 25px; }
.statistics-heading h1 { margin: 6px 0; font-size: 32px; }
.statistics-heading p { margin: 0; color: var(--muted); font-size: 14px; }
.statistics-time-controls { margin-bottom: 24px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); display: flex; flex-direction: column; gap: 14px; }
.statistics-time-presets { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 14px; }
.statistics-range-presets { display: flex; flex-wrap: wrap; gap: 6px; }
.statistics-range-preset.active { background: var(--green); color: white; border-color: var(--green); }
.statistics-resolution-select label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
.statistics-resolution-select select { padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; background: var(--bg); color: var(--text); }
.statistics-time-dates { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 18px; border-top: 1px solid var(--line); padding-top: 14px; }
.statistics-time-dates label { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 0 1 210px; font-size: 12px; font-weight: 600; color: var(--muted); }
/* #160/#169: iOS gives native date/time inputs an intrinsic width; reset it so they never overflow. */
.statistics-time-dates input[type="datetime-local"] { -webkit-appearance: none; appearance: none; display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 36px; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-size: 13px; font-weight: 400; background: var(--bg); color: var(--text); }
.statistics-time-dates input[type="datetime-local"]::-webkit-date-and-time-value { text-align: left; }
.statistics-period-label { margin: -2px 0 0; color: var(--text); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.statistics-message { margin: 0 0 20px; padding: 12px 14px; border-radius: 8px; background: #fff0f0; color: #b91c1c; font-size: 13px; }
:root[data-theme="dark"] .statistics-message { background: #3b1414; color: #fca5a5; }
.statistics-footnotes { border-top: 1px solid var(--line); padding-top: 16px; color: var(--muted); font-size: 12px; line-height: 1.7; }
.statistics-footnotes p { margin: 0 0 12px; }
.statistics-definitions summary { cursor: pointer; font-weight: 600; }
.statistics-definitions li { margin: 10px 0; }
.statistics-coverage { margin-top: 18px !important; }
.statistics-empty { padding: 60px 20px; text-align: center; color: var(--muted); }
.statistics-empty h2 { font-size: 18px; }
.statistics-empty p { font-size: 13px; }
.statistics-loading-splash { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 300px; padding: 36px 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); text-align: center; }
.statistics-loading-splash h2 { margin: 0; font-size: 21px; }
.statistics-loading-splash p { max-width: 420px; margin: 0; color: var(--muted); font-size: 14px; line-height: 1.6; }
.statistics-loading-splash small { margin-top: 6px; color: var(--muted); font-size: 12px; }
.statistics-loading-spinner { color: var(--green); animation: statistics-spin 1s linear infinite; }
@keyframes statistics-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .statistics-loading-spinner { animation: none; } }
@media (max-width: 650px) {
  .statistics-heading { flex-direction: column; align-items: stretch; }
  .statistics-heading h1 { font-size: 26px; }
  .statistics-time-presets { flex-direction: column; align-items: stretch; }
  .statistics-time-dates { flex-direction: column; align-items: stretch; }
  .statistics-time-dates label { flex: 0 0 auto; }
}
</style>
