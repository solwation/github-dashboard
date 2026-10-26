<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { Activity, CircleCheck, Layers3, LayoutDashboard, Plus } from "@lucide/vue";
import OverviewEstimate from "./OverviewEstimate.vue";
import { overviewClosedSummary, overviewEstimateGroups, overviewRepositoryInfo } from "../lib/overview-estimates";
import { useLanguage } from "../lib/i18n";
import { estimateLabel } from "../lib/estimates";
import { untilNext, useNow } from "../composables/useNow";
import type { Lane, Rules } from "../lib/model";
import { coalesceDeltas, VALUE_DELTA_MS, ValueDeltaTracker } from "../lib/value-delta";
import { emptyCounts, OVERVIEW_DELTA_MS, OverviewFeedbackTracker, overviewKeys, signedDelta, summarizeOverviewSecondary, type OverviewCounts, type OverviewOutcome } from "../lib/overview-feedback";
const props = defineProps<{
  query?: string; repositoryQueries?: Record<string, string>;
  counts: OverviewCounts; lanes: Lane[]; rules: Record<string, Rules>; hideCoordination: boolean;
  live: boolean; session: number | string; loggedIn: boolean;
}>();
const emit = defineEmits<{ chooseRepositories: [] }>();
const { t } = useLanguage();
// Active and closed-today counts only move with whole minutes; new data recomputes them with the current time.
const clock = useNow(at => untilNext(at, 60000), { board: true });
const current = () => Math.max(clock.value, Date.now());
const tracker = new OverviewFeedbackTracker();
const deltas = reactive(emptyCounts());
const outcomes = reactive<Record<keyof OverviewCounts, OverviewOutcome>>({ open: null, progress: null, closed: null });
const timers = new Map<keyof OverviewCounts, ReturnType<typeof setTimeout>>();
let previousDisplay: OverviewCounts | null = null;
// Sub-value deltas (#188): baseline resets on board/filter/session changes, clock drift is rebaselined silently.
type SecondaryKey = keyof ReturnType<typeof summarizeOverviewSecondary>;
const secondaryKeys: SecondaryKey[] = ["activeRepositories", "backlogRepositories", "backlogIssues", "highPriorityOpen", "progressRepositories", "highPriorityProgress", "closedToday", "closedLast7Days"];
const secondaryTracker = new ValueDeltaTracker<SecondaryKey>();
const cellDeltas = reactive<Partial<Record<SecondaryKey, number>>>({});
const cellTimers = new Map<SecondaryKey, ReturnType<typeof setTimeout>>();
function clearCell(key: SecondaryKey) { clearTimeout(cellTimers.get(key)); cellTimers.delete(key); delete cellDeltas[key]; }
function trackSecondary() {
  const values = summarizeOverviewSecondary(props.lanes, props.rules, current(), props.hideCoordination, { query: props.query, repositoryQueries: props.repositoryQueries });
  const scope = JSON.stringify([props.session, props.hideCoordination, props.query || "", props.repositoryQueries || {}, props.lanes.map(lane => lane.repo.full_name).sort(), props.rules]);
  const changes = secondaryTracker.update(values, scope, props.live);
  if (!props.live) for (const key of secondaryKeys) clearCell(key);
  const merged = coalesceDeltas({}, changes);
  for (const key of secondaryKeys) {
    const incoming = merged[key];
    if (!incoming) continue;
    clearTimeout(cellTimers.get(key));
    const sum = (cellDeltas[key] || 0) + incoming;
    if (sum) cellDeltas[key] = sum; else delete cellDeltas[key];
    cellTimers.set(key, setTimeout(() => clearCell(key), VALUE_DELTA_MS));
  }
}
function clear(key: keyof OverviewCounts) {
  clearTimeout(timers.get(key)); timers.delete(key); deltas[key] = 0; outcomes[key] = null;
}
// Depth 3 reaches rule fields edited in place; lanes are replaced, so their issues need no traversal (#121).
watch(() => [props.counts, props.lanes, props.rules, props.hideCoordination, props.live, props.session, props.query, props.repositoryQueries], () => {
  const changes = tracker.update(props.lanes, props.rules, props.hideCoordination, props.live, props.session, { query: props.query, repositoryQueries: props.repositoryQueries });
  for (const key of overviewKeys) {
    const visibleChange = previousDisplay ? props.counts[key] - previousDisplay[key] : 0;
    if (changes[key] && visibleChange) {
      clearTimeout(timers.get(key));
      // A filtered card may expose only part of the underlying change.
      const amount = Math.sign(changes[key]) === Math.sign(visibleChange)
        ? Math.sign(visibleChange) * Math.min(Math.abs(changes[key]), Math.abs(visibleChange)) : 0;
      deltas[key] += amount;
      if (!deltas[key]) outcomes[key] = null;
      else if (key === "progress") {
        const outcome = tracker.progressOutcome || (amount > 0 ? "positive" : null);
        // Keep setbacks visible if a burst also contains completed work.
        outcomes[key] = outcomes[key] === "negative" || outcome === "negative" ? "negative" : outcome || outcomes[key];
      } else outcomes[key] = deltas[key] > 0 ? "positive" : "negative";
      timers.set(key, setTimeout(() => clear(key), OVERVIEW_DELTA_MS));
    } else if (visibleChange || !props.live) clear(key);
  }
  previousDisplay = { ...props.counts };
  trackSecondary();
}, { immediate: true, deep: 3 });
watch(clock, () => secondaryTracker.rebaseline(summarizeOverviewSecondary(props.lanes, props.rules, current(), props.hideCoordination, { query: props.query, repositoryQueries: props.repositoryQueries })));
onBeforeUnmount(() => { for (const key of overviewKeys) clear(key); for (const key of secondaryKeys) clearCell(key); });
const estimateGroups = computed(() => overviewEstimateGroups(props.lanes, props.rules, props.hideCoordination, { query: props.query, repositoryQueries: props.repositoryQueries }));
const totalRepositories = computed(() => new Set(props.lanes.map(lane => lane.repo.full_name)).size);
const repositoryInfo = computed(() => overviewRepositoryInfo(props.lanes));
const repositoryInfoLabel = computed(() => [
  t("Privata: {count}", { count: repositoryInfo.value.private }), t("Publika: {count}", { count: repositoryInfo.value.public }),
  ...(repositoryInfo.value.owners > 1 ? [t("Ägare: {count}", { count: repositoryInfo.value.owners })] : []),
]);
const repositoryInfoTitle = computed(() => t("Valda repositories fördelade på privata och publika{owners}. Fritextfilter påverkar inte fördelningen.", { owners: repositoryInfo.value.owners > 1 ? t(" samt antal olika ägare") : "" }));
const closedSummary = computed(() => overviewClosedSummary(estimateGroups.value, current()));
const closedMedian = computed(() => closedSummary.value.medianMs === null ? "" : t("median {time}", { time: estimateLabel(closedSummary.value.medianMs) }));
const closedTitle = computed(() => [
  t("Uppskattade story points: cirka {points}", { points: closedSummary.value.points }),
  t("Poängen omfattar samma filtrerade stängda issues som antalet."),
  ...(closedMedian.value ? [t("Mediantid i arbete för {count} stängda issues med känd starttid: {time}", { count: closedSummary.value.measured, time: estimateLabel(closedSummary.value.medianMs!) })] : []),
].map(part => part.replace(/[.]$/, "")).join(". ") + ".");
const secondary = computed(() => summarizeOverviewSecondary(props.lanes, props.rules, current(), props.hideCoordination, { query: props.query, repositoryQueries: props.repositoryQueries }));
const activeDefinition = computed(() => t("Aktiva projekt har minst ett issue i Backlog eller In progress, eller ett issue stängt under de senaste 30 dagarna. Dolda koordinationsärenden räknas inte. Fritextfilter påverkar inte antalet."));
const todayDefinition = computed(() => t("Inlästa issues i valda repositories som nu är stängda och har senaste stängning idag, i din lokala tidszon. Fritextfilter påverkar inte dagsuppgiften. Detta är inte en komplett historik över stängningar."));
interface SummaryCell { key: SecondaryKey; text: string; className?: string; title?: string }
const cards = computed(() => [
  {
    key: "open" as const, label: t("Öppna issues"), hint: t("att ta vidare"), icon: LayoutDashboard, style: "backlog",
    cells: [
      { key: "backlogIssues", text: t("{count} backlog", { count: secondary.value.backlogIssues }) },
      { key: "highPriorityOpen", text: t("{count} hög prio", { count: secondary.value.highPriorityOpen }) },
    ] as SummaryCell[],
  },
  {
    key: "progress" as const, label: t("Pågående"), hint: t("just nu"), icon: Activity, style: "progress",
    cells: [
      { key: "progressRepositories", text: t("{count} repos", { count: secondary.value.progressRepositories }) },
      { key: "highPriorityProgress", text: t("{count} hög prio", { count: secondary.value.highPriorityProgress }) },
    ] as SummaryCell[],
  },
  {
    key: "closed" as const, label: t("Stängda"), hint: t("senaste 30 dagarna"), icon: CircleCheck, style: "closed",
    cells: [
      { key: "closedToday", text: t("+{count} idag", { count: secondary.value.closedToday }), className: "stat-today", title: todayDefinition.value },
      { key: "closedLast7Days", text: t("{count} senaste 7 d", { count: secondary.value.closedLast7Days }) },
    ] as SummaryCell[],
  },
]);
const repositoryCells = computed(() => [
  { key: "activeRepositories" as const, text: t("{count} aktiva", { count: secondary.value.activeRepositories }) },
  { key: "backlogRepositories" as const, text: t("{count} backlog", { count: secondary.value.backlogRepositories }) },
]);
const announcement = computed(() => [
  ...cards.value.filter(card => deltas[card.key]).map(card => `${card.label}: ${signedDelta(deltas[card.key])}`),
  ...[...repositoryCells.value, ...cards.value.flatMap(card => card.cells)].filter(cell => cellDeltas[cell.key]).map(cell => `${cell.text}: ${signedDelta(cellDeltas[cell.key]!)}`),
].join(". "));
</script>
<template>
  <section class="stats" :aria-label="t('Sammanfattning')">
    <div class="stat repository-stat" data-stat="repositories">
      <span class="stat-icon repos"><Layers3 :size="20" /></span>
      <div class="stat-content">
        <!-- Deliberate section label commonly used in Swedish technical UI (#315) -->
        <span class="stat-label">Repositories</span>
        <strong>{{ totalRepositories }}</strong>
        <div class="overview-estimate" role="img" :title="repositoryInfoTitle" :aria-label="repositoryInfoTitle + ' ' + repositoryInfoLabel.join(', ')" data-testid="repository-info">
          <span class="overview-points">{{ repositoryInfoLabel[0] }}</span>
          <span v-for="part in repositoryInfoLabel.slice(1)" :key="part" class="overview-time">{{ part }}</span>
        </div>
        <div class="stat-cells">
          <span class="stat-cell repository-active" tabindex="0" :title="activeDefinition" :aria-label="t('{count} aktiva projekt. {definition}', { count: secondary.activeRepositories, definition: activeDefinition })">{{ repositoryCells[0].text }}<span v-if="cellDeltas.activeRepositories" class="cell-delta" :class="cellDeltas.activeRepositories > 0 ? 'up' : 'down'" aria-hidden="true">{{ signedDelta(cellDeltas.activeRepositories) }}</span></span>
          <span class="stat-cell">{{ repositoryCells[1].text }}<span v-if="cellDeltas.backlogRepositories" class="cell-delta" :class="cellDeltas.backlogRepositories > 0 ? 'up' : 'down'" aria-hidden="true">{{ signedDelta(cellDeltas.backlogRepositories) }}</span></span>
        </div>
      </div>
      <button v-if="loggedIn" class="icon-button repository-stat-action" :aria-label="t('Välj repositories')" :title="t('Välj repositories')" @click="emit('chooseRepositories')"><Plus :size="16" aria-hidden="true" /></button>
    </div>
    <div v-for="card in cards" :key="card.key" class="stat" :data-stat="card.key" :class="{ 'stat-positive': deltas[card.key] && outcomes[card.key] === 'positive', 'stat-negative': deltas[card.key] && outcomes[card.key] === 'negative' }">
      <span class="stat-icon" :class="card.style"><component :is="card.icon" :size="20" /></span>
      <div class="stat-content">
        <span class="stat-label">{{ card.label }}</span>
        <strong>{{ counts[card.key] }}<span v-if="deltas[card.key]" class="stat-delta" aria-hidden="true">{{ signedDelta(deltas[card.key]) }}</span><small>{{ card.hint }}</small></strong>
        <OverviewEstimate v-if="card.key !== 'closed'" :groups="estimateGroups" :column="card.key" />
        <div v-else class="overview-estimate" role="img" :title="closedTitle" :aria-label="closedTitle" data-testid="closed-info">
          <span class="overview-points">≈ {{ closedSummary.points }} SP</span>
          <span v-if="closedMedian" class="overview-time">{{ closedMedian }}</span>
        </div>
        <div class="stat-cells">
          <span v-for="(cell, index) in card.cells" :key="index" class="stat-cell" :class="cell.className" :title="cell.title">{{ cell.text }}<span v-if="cellDeltas[cell.key]" class="cell-delta" :class="cellDeltas[cell.key]! > 0 ? 'up' : 'down'" aria-hidden="true">{{ signedDelta(cellDeltas[cell.key]!) }}</span></span>
        </div>
      </div>
    </div>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </section>
</template>
<style scoped>
.stat { transition: background-color .25s, border-color .25s; }
.repository-active:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; border-radius: 3px; }
.stat-content { min-width: 0; flex: 1 1 auto; align-self: stretch; display: flex; flex-direction: column; }
.stat strong { flex-wrap: wrap; row-gap: 6px; margin-bottom: .55rem; }
.stat strong small { white-space: normal; }
.stat-cells {
  display: flex;
  flex-wrap: wrap;
  gap: .35rem .9rem;
  margin-top: auto;
  padding-top: .45rem;
  border-top: 1px solid var(--line);
  font-size: .72rem;
  line-height: 1.3;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.stat-cell { flex: 1 1 max-content; min-width: 0; max-width: 100%; overflow-wrap: normal; position: relative; }
/* Floats over the cell (absolute) so it never shifts layout (#188). */
.cell-delta { position: absolute; top: 0; right: .2rem; font-size: .7rem; font-weight: 700; pointer-events: none; animation: cell-delta-float 2s ease-out forwards; }
.cell-delta.up { color: #19643c; }
.cell-delta.down { color: #943d28; }
:root[data-theme="dark"] .cell-delta.up { color: #8fd5ae; }
:root[data-theme="dark"] .cell-delta.down { color: #f0a58f; }
@keyframes cell-delta-float { 0% { opacity: 0; transform: translateY(0); } 15% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; transform: translateY(-.9rem); } }
.stat-positive { background-color: #eaf6ef; border-color: #65a781; }
.stat-negative { background-color: #fff0ec; border-color: #c8826c; }
.stat-delta { font-size: .75rem; font-weight: 600; color: #53636d; }
.stat-positive .stat-delta { color: #19643c; }
.stat-negative .stat-delta { color: #943d28; }
.overview-estimate { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin: -.1rem 0 .6rem; font-size: .7rem; line-height: 1.4; font-variant-numeric: tabular-nums; }
.overview-points { color: var(--green); font-weight: 650; white-space: nowrap; }
.overview-time { color: var(--text); }
@media (max-width: 650px) { .overview-estimate { justify-content: center; } }
.stat-today { color: #286b51; }
@media (prefers-reduced-motion: reduce) { .stat { transition: none; } .cell-delta { animation: none; transform: none; } }
</style>
