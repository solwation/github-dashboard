<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import { Activity, CircleCheck, Layers3, LayoutDashboard, Plus } from "@lucide/vue";
import { useLanguage } from "../lib/i18n";
import type { Lane, Rules } from "../lib/model";
import { countClosedToday, emptyCounts, OVERVIEW_DELTA_MS, OverviewFeedbackTracker, overviewKeys, signedDelta, type OverviewCounts } from "../lib/overview-feedback";
const props = defineProps<{
  counts: OverviewCounts; lanes: Lane[]; rules: Record<string, Rules>; hideCoordination: boolean;
  live: boolean; session: number | string; now: number; loggedIn: boolean; busy: boolean;
}>();
const emit = defineEmits<{ chooseRepositories: [] }>();
const { t } = useLanguage();
const tracker = new OverviewFeedbackTracker();
const deltas = reactive(emptyCounts());
const timers = new Map<keyof OverviewCounts, ReturnType<typeof setTimeout>>();
let previousDisplay: OverviewCounts | null = null;
function clear(key: keyof OverviewCounts) {
  clearTimeout(timers.get(key)); timers.delete(key); deltas[key] = 0;
}
watch(() => [props.counts, props.lanes, props.rules, props.hideCoordination, props.live, props.session], () => {
  const changes = tracker.update(props.lanes, props.rules, props.hideCoordination, props.live, props.session);
  for (const key of overviewKeys) {
    const visibleChange = previousDisplay ? props.counts[key] - previousDisplay[key] : 0;
    if (changes[key] && visibleChange) {
      clearTimeout(timers.get(key));
      // A filtered card may expose only part of the underlying change.
      const amount = Math.sign(changes[key]) === Math.sign(visibleChange)
        ? Math.sign(visibleChange) * Math.min(Math.abs(changes[key]), Math.abs(visibleChange)) : 0;
      deltas[key] += amount;
      timers.set(key, setTimeout(() => clear(key), OVERVIEW_DELTA_MS));
    } else if (visibleChange || !props.live) clear(key);
  }
  previousDisplay = { ...props.counts };
}, { immediate: true, deep: true });
onBeforeUnmount(() => { for (const key of overviewKeys) clear(key); });
const today = computed(() => countClosedToday(props.lanes, props.now, props.hideCoordination));
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
      <div><span class="stat-label">Repositories</span><strong>{{ lanes.length }}<small>{{ t("i din översikt") }}</small></strong></div>
      <button v-if="loggedIn" class="icon-button repository-stat-action" :aria-label="t('Välj repositories')" :title="t('Välj repositories')" :disabled="busy" @click="emit('chooseRepositories')"><Plus :size="16" aria-hidden="true" /></button>
    </div>
    <div v-for="card in cards" :key="card.key" class="stat" :data-stat="card.key" :class="{ 'stat-increase': deltas[card.key] > 0, 'stat-decrease': deltas[card.key] < 0 }">
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
.stat-content { min-width: 0; }
.stat strong { flex-wrap: wrap; row-gap: 6px; }
.stat strong small { white-space: normal; }
.stat-increase { background-color: #eaf6ef; border-color: #65a781; }
.stat-decrease { background-color: #fff0ec; border-color: #c8826c; }
.stat-delta { font-size: .75rem; font-weight: 600; color: #19643c; }
.stat-decrease .stat-delta { color: #943d28; }
.stat-today { display: inline-block; margin-top: .5rem; font-size: .75rem; color: #286b51; }
.stat-today-note { color: #61766d; font-size: .6875rem; }
@media (prefers-reduced-motion: reduce) { .stat { transition: none; } }
</style>
