<script setup lang="ts">
import { normalizeStatisticsPreference, statisticsRepositoryCollapsed } from "../lib/statistics-preferences";
import { StatisticsPreviewBatch } from "../lib/statistics-progress";
import type { StatisticsLoadStatus } from "../lib/statistics-load-status";
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { RefreshCw, BarChart3, RotateCcw } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Repo } from "../lib/model";
import { StatisticsCollector, type StatisticsClient } from "../lib/statistics-client";
import {
  allowedStatisticsResolutions, clampStatisticsResolution, DEFAULT_STATISTICS_RANGE, formatStatisticsBound, hasStatisticsTime,
  parseStatisticsBound, rangeNames, resolutionNames, statisticsDurationMs, statisticsPresetWindow, statisticsRangeMs, statisticsRanges,
  statisticsResolutions, statisticsCalendarWindow, statisticsWindowMs, validStatisticsBound, type StatisticsData, type StatisticsPreference,
  type StatisticsPreferences, type StatisticsRangePreset, type StatisticsResolution,
} from "../lib/statistics";
import { readStatisticsCache, writeStatisticsCache } from "../lib/statistics-cache";
import { demoStatistics } from "../lib/statistics-demo";
import { formatBrowserDateTime, parseBrowserDateTime, isAmbiguousBrowserTime } from "../lib/browser-time";
import StatisticsRepository from "./StatisticsRepository.vue";
const { t, locale } = useLanguage();
const props = defineProps<{ navigation?: { name: string; toggle: boolean; sequence: number }; client: StatisticsClient | null; repositories: Repo[]; demo: boolean; session: number | string; preferences?: StatisticsPreferences; credential?: string }>();
const emit = defineEmits<{ "update:preferences": [value: StatisticsPreferences] }>();
const period = ref(statisticsCalendarWindow());
const preferencesState = ref<StatisticsPreferences>({ ...props.preferences });
const fromInput = ref<HTMLInputElement | null>(null);
const toInput = ref<HTMLInputElement | null>(null);

// Saved bounds stay absolute UTC minute strings; only the picker view uses local wall time.
// A preset recomputes its window from now; undefined range = custom.
const periodBounds = computed(() => ({
  start: parseStatisticsBound(period.value.from, "start"),
  end: parseStatisticsBound(period.value.to, "end"),
}));
const pickerMin = computed(() => formatBrowserDateTime(periodBounds.value.start));
const pickerMax = computed(() => formatBrowserDateTime(periodBounds.value.end));
function presetWindow(preset: StatisticsRangePreset, resolution?: StatisticsResolution) {
  return statisticsPresetWindow(preset, Date.now(), period.value, resolution, { calendar: "local" });
}
const initialWindow = presetWindow(DEFAULT_STATISTICS_RANGE);
const globalFrom = ref(initialWindow.from);
const globalTo = ref(initialWindow.to);
const globalRange = ref<StatisticsRangePreset | undefined>(DEFAULT_STATISTICS_RANGE);
const globalResolution = ref<StatisticsResolution | undefined>(undefined);

function applyPreset(preset: StatisticsRangePreset, resolution?: StatisticsResolution) {
  const clamped = resolution ? clampStatisticsResolution(resolution, statisticsRangeMs[preset], preset) : undefined;
  const window = presetWindow(preset, clamped);
  fromInput.value?.setCustomValidity("");
  toInput.value?.setCustomValidity("");
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
function formatPeriodBound(ms: number) {
  return new Intl.DateTimeFormat(locale.value, {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(isAmbiguousBrowserTime(ms) ? { timeZoneName: "shortOffset" as const } : {}),
  }).format(ms);
}
const periodText = computed(() => {
  if (invalidRange.value) return "";
  const { start, end } = statisticsWindowMs({ from: globalFrom.value, to: globalTo.value });
  return `${formatPeriodBound(start)} – ${formatPeriodBound(end)}`;
});
const localFrom = computed(() => formatBrowserDateTime(parseStatisticsBound(globalFrom.value, "start")));
const localTo = computed(() => formatBrowserDateTime(parseStatisticsBound(globalTo.value, "end")));
const durationLabel = computed(() => {
  if (invalidRange.value) return "";
  const { start, end } = statisticsWindowMs({ from: globalFrom.value, to: globalTo.value });
  const unit = (value: number, unit: "day" | "hour" | "minute") => unit === "day"
    ? t(value === 1 ? "{count} dag" : "{count} dagar", { count: value.toLocaleString(locale.value) })
    : new Intl.NumberFormat(locale.value, { style: "unit", unit, unitDisplay: "long" }).format(value);
  if (activeRange.value?.endsWith("d")) return unit(Number.parseInt(activeRange.value), "day");
  const from = new Date(start), to = new Date(end);
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (start === dayStart(from) && end === dayStart(to)) {
    const days = (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 86_400_000;
    return unit(days, "day");
  }
  const total = Math.round((end - start) / 60_000), days = Math.floor(total / 1440), hours = Math.floor(total % 1440 / 60), minutes = total % 60;
  const parts = [days ? unit(days, "day") : "", hours ? unit(hours, "hour") : "", minutes ? unit(minutes, "minute") : ""].filter(Boolean);
  return new Intl.ListFormat(locale.value, { style: "short", type: "unit" }).format(parts);
});
const periodLabel = computed(() => periodText.value ? t("Visar {period} ({duration})", { period: periodText.value, duration: durationLabel.value }) : "");
function changeRange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "custom") void selectCustom();
  else selectRange(value as StatisticsRangePreset);
}
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

/** Lazily roll local calendar bounds forward without clearing the rendered snapshots. */
function refreshCalendarPeriod() {
  const next = statisticsCalendarWindow();
  if (next.from === period.value.from && next.to === period.value.to) return false;
  period.value = next;
  return true;
}
let rolloverReloadPending = false;
function flushRolloverReload() {
  if (rolloverReloadPending && !busy.value) void load(true);
}
function refreshPeriodForInteraction() {
  if (!refreshCalendarPeriod()) return;
  if (globalRange.value) applyPreset(globalRange.value, globalResolution.value);
  else if (Number.isFinite(statisticsWindowMs({ from: globalFrom.value, to: globalTo.value }).start) && !clampCustomWindow()) {
    applyPreset(DEFAULT_STATISTICS_RANGE, globalResolution.value);
  }
  applyGlobalTimeSpan();
  // A current request finishes first; several same-day interactions share one revalidation.
  rolloverReloadPending = true;
  void nextTick(flushRolloverReload);
}

function selectRange(preset: StatisticsRangePreset) {
  refreshPeriodForInteraction();
  applyPreset(preset, globalResolution.value);
  applyGlobalTimeSpan();
}

async function selectCustom() {
  refreshPeriodForInteraction();
  // Keeps the shown window but detaches it from the preset, then moves focus to the pickers.
  if (globalRange.value) {
    globalRange.value = undefined;
    applyGlobalTimeSpan();
  }
  await nextTick();
  fromInput.value?.focus();
}

function selectResolution(resolution: StatisticsResolution) {
  refreshPeriodForInteraction();
  if (!allowedResolutions.value.has(resolution)) return;
  if (globalRange.value) applyPreset(globalRange.value, resolution);
  else globalResolution.value = resolution;
  applyGlobalTimeSpan();
}

// Preserve an untouched ambiguous autumn value exactly; parse only the edited field.
function setLocalBound(event: Event, edge: "start" | "end") {
  refreshPeriodForInteraction();
  const input = event.target as HTMLInputElement;
  const current = edge === "start" ? localFrom.value : localTo.value;
  if (input.value === current) return;
  const ms = parseBrowserDateTime(input.value);
  if (!Number.isFinite(ms)) {
    input.setCustomValidity(t("Tiden finns inte i din tidszon. Välj en annan tid."));
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  const value = formatStatisticsBound(ms);
  setBounds(edge === "start" ? value : globalFrom.value, edge === "end" ? value : globalTo.value);
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
  refreshPeriodForInteraction();
  applyPreset(DEFAULT_STATISTICS_RANGE);
  applyGlobalTimeSpan();
}

const snapshots = shallowRef<Record<string, StatisticsData>>({});
const loadStatuses = shallowRef<Record<string, StatisticsLoadStatus>>({});
function clearLoadStatus(name: string) {
  previewBatch.discard(name);
  if (!(name in loadStatuses.value)) return;
  const next = { ...loadStatuses.value };
  delete next[name];
  loadStatuses.value = next;
}
const previewBatch = new StatisticsPreviewBatch((previews, statuses) => {
  snapshots.value = { ...snapshots.value, ...previews };
  loadStatuses.value = { ...loadStatuses.value, ...statuses };
});
const renderedRepositories = computed(() => props.repositories);
const loading = ref<Record<string, boolean>>({});
const cacheFailed = ref(false);
const failures = ref<Record<string, boolean>>({});
const busy = computed(() => props.repositories.some(repo => loading.value[repo.full_name]));
watch(busy, value => { if (!value) flushRolloverReload(); });
const initialLoading = computed(() => busy.value && !expandedRepositories.value.some(repo => {
  const data = snapshots.value[repo.full_name];
  return data && [data.issues, data.events, data.commits, data.changes, data.pulls].some(source => source !== null);
}));
const completed = computed(() => expandedRepositories.value.filter(repo => loading.value[repo.full_name] === false).length);
const partial = computed(() => expandedRepositories.value.some(repo => {
  const data = snapshots.value[repo.full_name];
  return !!data && ([data.issues, data.events, data.commits, data.changes, data.pulls].some(source => source?.complete === false) || !!data.changes?.data.some(change => !change.filesComplete));
}));
const historyVerifiedAt = computed(() => {
  const values = expandedRepositories.value.map(repo => snapshots.value[repo.full_name]?.commits).filter(source => source?.historyVerifiedAt && source.historyVerifiedAt < source.fetchedAt).map(source => source!.historyVerifiedAt!);
  return values.length ? Math.min(...values) : null;
});
const collapsedRepositories = computed(() => new Set(props.repositories.filter((repo, index) =>
  statisticsRepositoryCollapsed(preferencesState.value, repo.full_name, index)).map(repo => repo.id)));
const expandedRepositories = computed(() => props.repositories.filter(repo => !collapsedRepositories.value.has(repo.id)));
const repositoryRuns = new Map<string, number>();
function initializeCollapsePreferences() {
  let changed = false;
  const next = { ...preferencesState.value };
  props.repositories.forEach((repo, index) => {
    if (typeof next[repo.full_name]?.collapsed === "boolean") return;
    next[repo.full_name] = { ...normalizeStatisticsPreference(next[repo.full_name], period.value), ...timeSpan.value,
      collapsed: statisticsRepositoryCollapsed(next, repo.full_name, index) };
    changed = true;
  });
  if (changed) { preferencesState.value = next; emit("update:preferences", next); }
}
function setCollapsed(id: number, collapsed: boolean) {
  const repository = props.repositories.find(repo => repo.id === id);
  if (!repository) return;
  updatePreference(repository.full_name, { ...normalizeStatisticsPreference(preferencesState.value[repository.full_name], period.value), collapsed });
}
let followedAnchor = "";
let sidebarAnchor = "";
async function followRepositoryAnchor(hash = window.location.hash) {
  if (!/^#statistics-repo-\d+$/.test(hash) || followedAnchor === hash) return;
  await nextTick();
  const target = document.getElementById(hash.slice(1));
  if (!target?.getClientRects().length) return;
  const id = Number(hash.slice("#statistics-repo-".length));
  if (sidebarAnchor !== hash && collapsedRepositories.value.has(id)) { setCollapsed(id, false); await nextTick(); }
  // Loading content can change the sections above this target; scroll once it has settled.
  if (initialLoading.value) return;
  target.scrollIntoView({ block: "start" });
  followedAnchor = hash;
}
watch([initialLoading, renderedRepositories], () => { void followRepositoryAnchor(); }, { flush: "post" });
function followHashChange() {
  sidebarAnchor = "";
  followedAnchor = "";
  void followRepositoryAnchor();
}
onMounted(() => {
  window.addEventListener("hashchange", followHashChange);
  void followRepositoryAnchor();
});
let collector: StatisticsCollector | null = null;
let generation = 0;
let sessionEpoch = 0;
let restoration: Promise<void> = Promise.resolve();
function updatePreference(repository: string, value: StatisticsPreference) {
  const merged: StatisticsPreference = {
    ...value,
    collapsed: value.collapsed ?? preferencesState.value[repository]?.collapsed,
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
async function load(force = false, target?: string) {
  const run = target ? generation : ++generation;
  if (!target) { previewBatch.clear(); loadStatuses.value = {}; }
  else clearLoadStatus(target);
  const epoch = sessionEpoch, activeCollector = collector, token = props.credential;
  const names = expandedRepositories.value.filter(repo => !target || repo.full_name === target).map(repo => repo.full_name);
  const selected = new Set(props.repositories.map(repo => repo.full_name));
  snapshots.value = Object.fromEntries(Object.entries(snapshots.value).filter(([name]) => selected.has(name)));
  if (!names.length || (!props.demo && !collector)) { if (!target) loading.value = {}; return; }
  const periodChanged = refreshCalendarPeriod();
  // A repository-triggered load may join the collector's old pending request.
  // Keep the rollover queued until that request has settled, then force fresh data.
  if (rolloverReloadPending && !busy.value) {
    force = true;
    rolloverReloadPending = false;
  }
  // #169: a preset follows the clock on every reload; a custom window is kept (clamped to the period).
  const previous = `${globalFrom.value}|${globalTo.value}|${globalRange.value}`;
  if (globalRange.value) applyPreset(globalRange.value, globalResolution.value);
  else if ((periodChanged || !invalidRange.value)
    && Number.isFinite(statisticsWindowMs({ from: globalFrom.value, to: globalTo.value }).start)
    && !clampCustomWindow()) applyPreset(DEFAULT_STATISTICS_RANGE, globalResolution.value);
  if (previous !== `${globalFrom.value}|${globalTo.value}|${globalRange.value}`) applyGlobalTimeSpan();
  for (const name of names) {
    const data = activeCollector?.cached(name);
    if (!snapshots.value[name] && data) snapshots.value = { ...snapshots.value, [name]: data };
  }
  loading.value = { ...loading.value, ...Object.fromEntries(names.map(name => [name, true])) };
  if (!target) failures.value = {};
  // One collector owns the semaphore for every section on this page.
  await Promise.all(names.map(async name => {
    const repositoryRun = (repositoryRuns.get(name) ?? 0) + 1;
    repositoryRuns.set(name, repositoryRun);
    const current = () => run === generation && epoch === sessionEpoch && repositoryRuns.get(name) === repositoryRun
      && token === props.credential && expandedRepositories.value.some(repo => repo.full_name === name);
    try {
      const data = props.demo ? demoStatistics(name) : await activeCollector!.load(name, Date.now(), force, (preview, status) => {
        if (current() && activeCollector === collector) {
          previewBatch.add(name, preview, status);
        }
      });
      if (current()) { clearLoadStatus(name); snapshots.value = { ...snapshots.value, [name]: data }; }
      if (current() && activeCollector && token && !props.demo) {
        try { await writeStatisticsCache(token, activeCollector.export()); if (epoch === sessionEpoch) cacheFailed.value = false; }
        catch { if (epoch === sessionEpoch) cacheFailed.value = true; }
      }
    } catch { if (current()) failures.value = { ...failures.value, [name]: true }; }
    finally { if (current()) { clearLoadStatus(name); loading.value = { ...loading.value, [name]: false }; } }
  }));
}
watch([() => props.client, () => props.session, () => props.demo, () => props.credential], () => {
  generation++; previewBatch.clear(); loadStatuses.value = {}; const epoch = ++sessionEpoch;
  preferencesState.value = { ...props.preferences };
  initializeCollapsePreferences();
  repositoryRuns.clear();
  collector?.dispose(); collector = props.client ? new StatisticsCollector(props.client) : null;
  const activeCollector = collector, token = props.credential;
  snapshots.value = {}; period.value = statisticsCalendarWindow(); cacheFailed.value = false;
  loading.value = Object.fromEntries(expandedRepositories.value.map(repo => [repo.full_name, true]));
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
  initializeCollapsePreferences();
  for (const name of repositoryRuns.keys()) if (!selected.has(name)) { collector?.cancel(name); clearLoadStatus(name); repositoryRuns.delete(name); }
  void restoration.then(() => { if (epoch === sessionEpoch) return load(); });
});
watch(() => expandedRepositories.value.map(repo => repo.full_name), (names, previous) => {
  for (const name of previous) if (!names.includes(name)) {
    collector?.cancel(name); clearLoadStatus(name);
    repositoryRuns.set(name, (repositoryRuns.get(name) ?? 0) + 1);
    loading.value = { ...loading.value, [name]: false };
  }
  const epoch = sessionEpoch;
  for (const name of names) if (!previous.includes(name)) {
    const cached = collector?.cached(name);
    if (cached) snapshots.value = { ...snapshots.value, [name]: cached };
    void restoration.then(() => { if (epoch === sessionEpoch) return load(false, name); });
  }
});
watch(() => props.navigation, navigation => {
  if (!navigation) { sidebarAnchor = ""; return; }
  const repo = props.repositories.find(repository => repository.full_name === navigation.name);
  if (!repo) return;
  sidebarAnchor = "#statistics-repo-" + repo.id;
  followedAnchor = "";
  setCollapsed(repo.id, navigation.toggle ? !collapsedRepositories.value.has(repo.id) : false);
  void followRepositoryAnchor(sidebarAnchor);
}, { immediate: true });
onUnmounted(() => { previewBatch.clear(); loadStatuses.value = {}; rolloverReloadPending = false; generation++; sessionEpoch++; collector?.dispose(); window.removeEventListener("hashchange", followHashChange); });
</script>
<template>
  <section class="statistics-view" :aria-label="t('Statistik')">
    <div class="statistics-heading"><div><span class="eyebrow">{{ t("DITT ARBETE I SIFFROR") }}</span><h1>{{ t("Statistik") }}</h1></div><button class="button small" :disabled="busy || !expandedRepositories.length" @click="load(true)"><RefreshCw :size="15" :class="{ spinning: busy }" />{{ t("Uppdatera statistik") }}</button></div>
    <div v-if="repositories.length && !initialLoading" class="statistics-time-controls" role="region" :aria-label="t('Tidsintervall')">
      <div class="statistics-time-row">
        <p v-if="periodLabel" class="statistics-period-label" aria-live="polite">{{ periodLabel }}</p>
        <div class="statistics-time-selects">
          <label class="statistics-range-select">{{ t("Tidsintervall") }}
            <select :value="activeRange || 'custom'" @change="changeRange">
              <option v-for="preset in statisticsRanges" :key="preset" :value="preset">{{ t(rangeNames[preset]) }}</option>
              <option value="custom">{{ t("Anpassat") }}</option>
            </select>
          </label>
          <label class="statistics-resolution-select">{{ t("Upplösning") }}
            <select :value="activeResolution" @change="selectResolution(($event.target as HTMLSelectElement).value as StatisticsResolution)">
              <option v-for="res in statisticsResolutions" :key="res" :value="res" :disabled="!allowedResolutions.has(res)">{{ t(resolutionNames[res]) }}</option>
            </select>
          </label>
          <button v-if="resettable" type="button" class="icon-button statistics-time-reset" :aria-label="t('Återställ period')" :title="t('Återställ period')" @click="resetTimeSpan"><RotateCcw :size="15" aria-hidden="true" /></button>
        </div>
      </div>
      <div v-show="!activeRange" class="statistics-time-dates">
        <label>{{ t("Från") }}<input ref="fromInput" :value="localFrom" type="datetime-local" step="60" :min="pickerMin" :max="pickerMax" @input="($event.target as HTMLInputElement).setCustomValidity('')" @change="setLocalBound($event, 'start')" /></label>
        <label>{{ t("Till") }}<input ref="toInput" :value="localTo" type="datetime-local" step="60" :min="pickerMin" :max="pickerMax" @input="($event.target as HTMLInputElement).setCustomValidity('')" @change="setLocalBound($event, 'end')" /></label>
      </div>
    </div>
    <p v-if="cacheFailed" class="notice" role="status">{{ t("Statistiken kunde inte sparas på enheten. De hämtade graferna kan fortfarande användas.") }}</p>
    <p v-if="demo" class="notice">{{ t("Demostatistiken visar fiktiva data.") }}</p>
    <p v-if="invalidRange" role="status" class="statistics-message">{{ t("Välj ett giltigt datumintervall inom de senaste 30 dagarna.") }}</p>
    <div v-if="initialLoading" class="statistics-loading-splash" role="status" aria-live="polite">
      <RefreshCw class="statistics-loading-spinner" :size="34" aria-hidden="true" />
      <h2>{{ t("Hämtar och sammanställer statistik") }}</h2>
      <p>{{ t("Vi hämtar underlaget från GitHub. Tillgängliga värden visas löpande under hämtningen.") }}</p>
      <small>{{ t("Hämtning avslutad för {done} av {total} repositories.", { done: completed, total: expandedRepositories.length }) }}</small>
    </div>
    <div v-show="!invalidRange" class="statistics-repositories">
      <StatisticsRepository v-for="repository in renderedRepositories" :key="repository.full_name" :repository="repository"
        :data="snapshots[repository.full_name] || null" :loading="!!loading[repository.full_name]" :load-status="loadStatuses[repository.full_name]" :load-failed="!!failures[repository.full_name]"
        :period="period" :time-span="timeSpan" :preference="preferencesState[repository.full_name]" :collapsed="collapsedRepositories.has(repository.id)" @update:collapsed="setCollapsed(repository.id, $event)" @update:preference="updatePreference(repository.full_name, $event)" />
    </div>
    <div v-if="!repositories.length" class="statistics-empty"><BarChart3 :size="32" /><h2>{{ t("Ingen statistik att visa") }}</h2><p>{{ t("Välj repositories i översikten för att se deras statistik.") }}</p></div>
    <footer v-if="repositories.length && !initialLoading" class="statistics-footnotes">
      <p>{{ t("Kalenderdagar i din tidszon. Dagens värden är preliminära.") }}</p>
      <details class="statistics-panel statistics-definitions"><summary>{{ t("Definitioner och datatäckning") }}</summary><ul>
        <li>{{ t("Stängda och återöppnade issues räknas från faktiska GitHub-händelser. Samma issue kan stängas flera gånger. Nettoflöde = skapade + återöppnade − stängda; detta är förändringen, inte antalet öppna issues.") }}</li>
        <li>{{ t("Labels avser dagens labels, även när äldre händelser filtreras. Bidragsgivare avser skaparen för issues och pull requests, aktören för issue-händelser och författaren för commits. Ett labelfilter döljer kodstatistik eftersom commits inte har issue-labels.") }}</li>
        <li>{{ t("Commits följer standardbranchens historik och grupperas efter committer-datum i din tidszon. Merge-commits räknas som commits men deras diff undantas från kodmåtten för att undvika dubbelräkning. Filändringar är summan av berörda filer per commit, inte unika filer i perioden.") }}</li>
        <li>{{ t("Medianålder vid stängning mäter tiden från skapande till varje stängningshändelse i urvalet, inte aktiv arbetstid. Pull requests räknas separat efter skapande, merge och stängning utan merge.") }}</li>
        <li>{{ t("Per repository hämtas högst 300 uppdaterade issues, 10 000 issue-händelser, 300 commits och 300 pull requests. Kodmått omfattar högst 600 vanliga commits och 300 filer per commit. Begränsade källor markeras som delvis data. Underlaget återanvänds i fem minuter; Uppdatera omvaliderar hela perioden.") }}</li>
        <li>{{ t("Statistik sparas krypterat för högst tio repositories i sju dagar, upp till 8 MiB. Issues, händelser och pull requests omvalideras alltid. Commithistorik återanvänds med överlapp från den senast hämtade delen, och omvalideras helt minst var sjunde dag eller vid Uppdatera. SHA-bundna kodmått återanvänds. Återanvända källdata kan innehålla högst 600 commits; ofullständig täckning markeras som delvis data.") }}</li>
      </ul></details>
      <p v-if="historyVerifiedAt">{{ t("Äldsta omvalideringen av återanvänd commithistorik: {time}.", { time: new Date(historyVerifiedAt).toLocaleString(locale) }) }}</p>
      <p v-if="partial" class="statistics-coverage">{{ t("Delvis data: markerade värden omfattar det underlag som hann hämtas inom sidans gränser. De är inte fullständiga totalsummor.") }}</p>
    </footer>
  </section>
</template>
<style scoped>
.statistics-view { width: 100%; min-width: 0; }
.statistics-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 25px; }
.statistics-heading h1 { margin: 6px 0; font-size: 32px; }
.statistics-time-controls { margin-bottom: 24px; padding: 12px 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); display: flex; flex-direction: column; gap: 12px; }
.statistics-time-row { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; min-width: 0; }
.statistics-time-selects { display: flex; align-items: center; justify-content: flex-end; flex-shrink: 0; gap: 12px; margin-left: auto; }
.statistics-time-selects label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
.statistics-time-selects select { min-width: 0; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-weight: 400; background: var(--bg); color: var(--text); }
.statistics-time-reset { flex-shrink: 0; min-width: 32px; min-height: 32px; }
.statistics-time-dates { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px 18px; border-top: 1px solid var(--line); padding-top: 14px; }
.statistics-time-dates label { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 0 1 210px; font-size: 12px; font-weight: 600; color: var(--muted); }
/* #160/#169: iOS gives native date/time inputs an intrinsic width; reset it so they never overflow. */
.statistics-time-dates input[type="datetime-local"] { -webkit-appearance: none; appearance: none; display: block; width: 100%; max-width: 100%; min-width: 0; min-height: 36px; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-size: 13px; font-weight: 400; background: var(--bg); color: var(--text); }
.statistics-time-dates input[type="datetime-local"]::-webkit-date-and-time-value { text-align: left; }
.statistics-period-label { min-width: 0; margin: 0; color: var(--text); font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
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
@media (max-width: 1100px) {
  .statistics-time-row { flex-wrap: wrap; }
}
@media (max-width: 650px) {
  .statistics-time-selects { width: 100%; justify-content: flex-start; flex-wrap: wrap; gap: 10px 12px; }
  .statistics-time-selects label { flex: 1 1 100px; flex-wrap: wrap; }
  .statistics-time-selects select { flex: 1 1 auto; max-width: 100%; }

  .statistics-heading { flex-direction: column; align-items: stretch; }
  .statistics-heading h1 { font-size: 26px; }
  .statistics-time-dates { flex-direction: column; align-items: stretch; }
  .statistics-time-dates label { flex: 0 0 auto; }
}
</style>
