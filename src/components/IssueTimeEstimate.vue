<script setup lang="ts">
import { computed } from "vue";
import { useIssueForecast } from "../composables/useIssueForecast";
import { estimateLabel } from "../lib/estimates";
import { useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";
const props = defineProps<{ issue: Issue; repository?: string; active?: boolean }>();
const { t } = useLanguage();
const { basis, estimate } = useIssueForecast(props);
const total = computed(() => {
  if (!estimate.value) return "";
  const formatted = estimateLabel(estimate.value.totalMs);
  return formatted.startsWith("≈") ? formatted : `≈ ${formatted}`;
});
// A Backlog parent whose sub-issue work has started shows the group's remaining time (#281).
const remaining = computed(() => estimate.value?.remainingMs == null ? null : estimate.value);
const label = computed(() => !remaining.value ? total.value : remaining.value.overdue ? t("över uppskattning")
  : t("{time} kvar", { time: estimateLabel(remaining.value.remainingMs!) }));
const description = computed(() => [
  t("Uppskattad tid: {time}", { time: total.value }),
  ...(remaining.value ? [
    ...(remaining.value.subIssueSpentMs > 0 ? [t("Tid på underärenden avdragen: {time}", { time: estimateLabel(remaining.value.subIssueSpentMs) })] : []),
    remaining.value.overdue ? t("Uppskattad tid kvar: över uppskattning") : t("Uppskattad tid kvar: {time}", { time: estimateLabel(remaining.value.remainingMs!) }),
  ] : []),
  ...(basis.value ? [t("Baserat på median tid per poäng från {count} användbara stängningar i detta repository inom {days} dagar.", {
    count: basis.value.samples, days: basis.value.windowDays,
  })] : []),
].join(". "));
</script>
<template>
  <em v-if="estimate" class="issue-time-estimate" :title="description" :aria-label="description">{{ label }}</em>
</template>
<style scoped>
.issue-time-estimate { color: var(--green); font-size: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
</style>
