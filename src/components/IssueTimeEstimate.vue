<script setup lang="ts">
import { computed } from "vue";
import { useIssueForecast } from "../composables/useIssueForecast";
import { estimateLabel } from "../lib/estimates";
import { useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";
const props = defineProps<{ issue: Issue; repository?: string; active?: boolean }>();
const { t } = useLanguage();
const { basis, estimate } = useIssueForecast(props);
const label = computed(() => {
  if (!estimate.value) return "";
  const formatted = estimateLabel(estimate.value.totalMs);
  return formatted.startsWith("≈") ? formatted : `≈ ${formatted}`;
});
const description = computed(() => [
  t("Uppskattad tid: {time}", { time: label.value }),
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
