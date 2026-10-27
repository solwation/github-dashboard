<script setup lang="ts">
import { computed } from "vue";
import { useNow } from "../composables/useNow";
import { useSubIssueWork } from "../composables/useSubIssueWork";
import { estimateLabel, nextHistoryExpiry } from "../lib/estimates";
import { overviewPoints, overviewPointSummary, overviewTimeEstimate, type OverviewEstimateColumn, type OverviewEstimateGroup } from "../lib/overview-estimates";
import { useLanguage } from "../lib/i18n";
const props = defineProps<{ groups: OverviewEstimateGroup[]; column: OverviewEstimateColumn }>();
const { t } = useLanguage();
const children = useSubIssueWork(() => props.groups);
const now = useNow(at => {
  const current = overviewTimeEstimate(props.groups, props.column, at, children.value);
  if (current.remainingMs === null) return Infinity;
  const countdown = current.counting ? ((current.remainingMs - 30000) % 60000 + 60000) % 60000 || 60000 : Infinity;
  const expiry = Math.min(...props.groups.map(group => {
    const next = nextHistoryExpiry(group.issues, at, { rules: group.rules });
    return next === null ? Infinity : next - at;
  }));
  return Math.min(countdown, expiry, current.nextStartMs - at, 86400000);
}, { board: true });
const estimate = computed(() => overviewTimeEstimate(props.groups, props.column, now.value, children.value));
// Points follow the time's sub-issue grouping (#281); the tooltip says so when that changes them.
const size = computed(() => overviewPointSummary(props.groups, props.column, children.value, now.value));
const points = computed(() => size.value.points);
const grouped = computed(() => points.value !== overviewPoints(props.groups, props.column, undefined, now.value));
const time = computed(() => estimate.value.remainingMs === null ? "" : estimate.value.remainingMs === 0 && estimate.value.overdue
  ? t("över uppskattning") : t("{time} kvar", { time: estimateLabel(estimate.value.remainingMs) }));
const partial = computed(() => estimate.value.knownRepositories > 0 && estimate.value.knownRepositories < estimate.value.repositories);
const coverage = computed(() => t("Tid för {known} av {total} repos", { known: estimate.value.knownRepositories, total: estimate.value.repositories }));
const description = computed(() => [
  size.value.source === "label" ? t("Story points från labels: {points}", { points: points.value })
    : t("Uppskattade story points: cirka {points}", { points: points.value }),
  grouped.value ? t("Ett huvudärende och dess underärenden räknas en gång, med huvudärendets poäng, i den kolumn där gruppens tid räknas.")
    : t("Poängen omfattar samma filtrerade issues som antalet."),
  ...(time.value ? [
    estimate.value.remainingMs === 0 && estimate.value.overdue ? t("Uppskattad tid kvar: över uppskattning")
      : t("Uppskattad tid kvar: {time}", { time: estimateLabel(estimate.value.remainingMs!) }),
    ...(partial.value ? [coverage.value] : []),
    t("Tiden bygger på historisk tid per poäng och parallellitet inom varje repository. Långsammaste repository avgör."),
    t("Tid som redan lagts på pågående arbete och på underärenden (pågående eller stängda inom fönstret) dras av från huvudärendets uppskattning; underärenden räknas inte en gång till."),
    ...(estimate.value.unknownStart ? [t("{count} pågående saknar säker starttid och räknas med sin fulla uppskattade tid.", { count: estimate.value.unknownStart })] : []),
    ...(estimate.value.overdue ? [t("{count} pågående har passerat sin uppskattade tid.", { count: estimate.value.overdue })] : []),
  ] : []),
].map(part => part.replace(/[.]$/, "")).join(". ") + ".");
</script>
<template>
  <div class="overview-estimate" :title="description" role="img" :aria-label="description">
    <span class="overview-points">{{ size.source === "local" ? "≈ " : "" }}{{ points }} SP</span>
    <span v-if="time" class="overview-time">{{ time }}</span>
    <span v-if="partial" class="overview-coverage">{{ coverage }}</span>
  </div>
</template>
<style scoped>
.overview-estimate { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 6px; margin: 0; font-size: .7rem; line-height: 1.3; font-variant-numeric: tabular-nums; }
.overview-points { color: var(--green); font-weight: 650; white-space: nowrap; }
.overview-estimate { min-width: 0; max-width: 100%; }
.overview-points { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.overview-time { color: var(--text); }
.overview-coverage { flex-basis: 100%; color: var(--muted); font-size: .65rem; }
</style>
