<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";
import { storyPoints } from "../lib/story-points";
import { estimateLabel } from "../lib/estimates";
import { useIssueForecast } from "../composables/useIssueForecast";
import type { Issue } from "../lib/model";

const props = defineProps<{ issue: Issue; repository?: string; inProgress?: boolean; active?: boolean }>();
const { t } = useLanguage();
const size = computed(() => storyPoints(props.issue));
const { basis, estimate: forecast } = useIssueForecast(props);
const description = computed(() => {
  const parts = [size.value.source === "label"
    ? t("Story points från label: {points}", { points: size.value.points })
    : t("Uppskattade story points: cirka {points}", { points: size.value.points })];
  const estimate = forecast.value;
  if (estimate) {
    parts.push(t("Uppskattad tid: {time}", { time: estimateLabel(estimate.totalMs) }));
    if (estimate.subIssueSpentMs > 0) parts.push(t("Tid på underärenden avdragen: {time}", { time: estimateLabel(estimate.subIssueSpentMs) }));
    if (estimate.remainingMs !== null) parts.push(estimate.overdue
      ? t("Uppskattad tid kvar: över uppskattning")
      : t("Uppskattad tid kvar: {time}", { time: estimateLabel(estimate.remainingMs) }));
    parts.push(t("Baserat på median tid per poäng från {count} användbara stängningar i detta repository inom {days} dagar.", {
      count: basis.value!.samples, days: basis.value!.windowDays,
    }));
  }
  if (size.value.source === "local") parts.push(t("Grov storlek på skalan 1/2/3/5/8/13. En entydig poängetikett används först, annars en lokal uppskattning från titel och beskrivning. Inte uppmätt komplexitet."));
  return parts.map(part => part.replace(/[.]$/, "")).join(". ") + ".";
});
</script>

<template>
  <span class="issue-points" role="img" :aria-label="description" :title="description"><span class="issue-points-value">{{ size.source === "local" ? "≈ " : "" }}{{ size.points }} SP</span></span>
</template>

<style scoped>
.issue-points { min-width: 0; max-width: 100%; flex-shrink: 1; }
.issue-points-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
