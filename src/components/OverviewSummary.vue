<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { Activity, CircleCheck, Layers3, LayoutDashboard, Plus } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import { untilNext, useNow } from "../composables/useNow";
import type { Lane, Rules } from "../lib/model";
import { countActiveRepositories, countClosedToday, emptyCounts, OVERVIEW_DELTA_MS, OverviewFeedbackTracker, overviewKeys, signedDelta, type OverviewCounts, type OverviewOutcome } from "../lib/overview-feedback";
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
}, { immediate: true, deep: 3 });
onBeforeUnmount(() => { for (const key of overviewKeys) clear(key); });
const totalRepositories = computed(() => new Set(props.lanes.map(lane => lane.repo.full_name)).size);
const activeRepositories = computed(() => countActiveRepositories(props.lanes, props.rules, current(), props.hideCoordination));
const activeDefinition = computed(() => t("Aktiva projekt har minst ett issue i Backlog eller In progress, eller ett issue stängt under de senaste 30 dagarna. Dolda koordinationsärenden räknas inte. Fritextfilter påverkar inte antalet."));
const today = computed(() => countClosedToday(props.lanes, current(), props.hideCoordination));
const cards = computed(() => [
  { key: "open" as const, label: t("Öppna issues"), hint: t("att ta vidare"), icon: LayoutDashboard, style: "backlog" },
  { key: "progress" as const, label: t("Pågående"), hint: t("just nu"), icon: Activity, style: "progress" },
  { key: "closed" as const, label: t("Stängda"), hint: t("senaste 30 dagarna"), icon: CircleCheck, style: "closed" },
]);
const announcement = computed(() => cards.value.filter(card => deltas[card.key]).map(card => `${card.label}: ${signedDelta(deltas[card.key])}`).join(". "));
</script>
<template>
  <section class="stats" :aria-label="t('Sammanfattning')">
    <div class="stat repository-stat">
      <span class="stat-icon repos"><Layers3 :size="20" /></span>
      <div><span class="stat-label">Repositories</span><strong>{{ totalRepositories }}<small class="repository-active" tabindex="0" :title="activeDefinition" :aria-label="t('{count} aktiva projekt. {definition}', { count: activeRepositories, definition: activeDefinition })">{{ t("{count} aktiva", { count: activeRepositories }) }}</small></strong></div>
      <button v-if="loggedIn" class="icon-button repository-stat-action" :aria-label="t('Välj repositories')" :title="t('Välj repositories')" @click="emit('chooseRepositories')"><Plus :size="16" aria-hidden="true" /></button>
    </div>
    <div v-for="card in cards" :key="card.key" class="stat" :data-stat="card.key" :class="{ 'stat-positive': deltas[card.key] && outcomes[card.key] === 'positive', 'stat-negative': deltas[card.key] && outcomes[card.key] === 'negative' }">
      <span class="stat-icon" :class="card.style"><component :is="card.icon" :size="20" /></span>
      <div class="stat-content">
        <span class="stat-label">{{ card.label }}</span>
        <strong>{{ counts[card.key] }}<span v-if="deltas[card.key]" class="stat-delta" aria-hidden="true">{{ signedDelta(deltas[card.key]) }}</span><small>{{ card.hint }}</small></strong>
        <span v-if="card.key === 'closed'" class="stat-today" :title="t('Inlästa issues i valda repositories som nu är stängda och har senaste stängning idag, i din lokala tidszon. Fritextfilter påverkar inte dagsuppgiften. Detta är inte en komplett historik över stängningar.')">{{ t('+{count} idag', { count: today }) }} <span class="stat-today-note">· {{ t("inlästa issues") }}</span></span>
      </div>
    </div>
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</p>
  </section>
</template>
<style scoped>
.stat { transition: background-color .25s, border-color .25s; }
.repository-stat strong .repository-active { display: block; }
.repository-active:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; border-radius: 3px; }
.stat-content { min-width: 0; }
.stat strong { flex-wrap: wrap; row-gap: 6px; }
.stat strong small { white-space: normal; }
.stat-positive { background-color: #eaf6ef; border-color: #65a781; }
.stat-negative { background-color: #fff0ec; border-color: #c8826c; }
.stat-delta { font-size: .75rem; font-weight: 600; color: #53636d; }
.stat-positive .stat-delta { color: #19643c; }
.stat-negative .stat-delta { color: #943d28; }
.stat-today { display: inline-block; margin-top: .5rem; font-size: .75rem; color: #286b51; }
.stat-today-note { color: #61766d; font-size: .6875rem; }
@media (prefers-reduced-motion: reduce) { .stat { transition: none; } }
</style>
