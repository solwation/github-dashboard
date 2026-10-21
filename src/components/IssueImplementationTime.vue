<script setup lang="ts">
import { computed } from "vue";
import { Clock3 } from "@lucide/vue";
import { useClosedIssueOutcome } from "../composables/useIssueEstimates";
import { estimateLabel } from "../lib/estimates";
import { useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";
const props = defineProps<{ issue: Issue; repository?: string }>();
const { t } = useLanguage();
const outcome = useClosedIssueOutcome(() => props.issue, () => props.repository);
const actual = computed(() => estimateLabel(outcome.value?.actualMs ?? NaN).replace(/^≈\s*/, ""));
const direction = computed(() => !outcome.value || outcome.value.estimatedMs === null ? 0 : Math.sign(outcome.value.actualMs - outcome.value.estimatedMs));
const description = computed(() => {
  if (!outcome.value) return "";
  const observed = t("Faktisk arbetstid: {time}", { time: actual.value });
  if (outcome.value.estimatedMs === null) return observed;
  return observed + ". " + t("Uppskattad tid: {time}", { time: estimateLabel(outcome.value.estimatedMs) }) + ". " +
    (direction.value > 0 ? t("Längre än uppskattat") : direction.value < 0 ? t("Kortare än uppskattat") : t("Enligt uppskattning")) + ". " + t("Jämförelse med andra nyligen stängda ärenden");
});
</script>
<template>
  <span v-if="outcome" class="implementation-time" :class="{ over: direction > 0, under: direction < 0 }" :title="description" :aria-label="description">
    <Clock3 :size="12" aria-hidden="true" /><span>{{ actual }}</span><span v-if="direction" aria-hidden="true">{{ direction > 0 ? '↑' : '↓' }}</span>
  </span>
</template>
<style scoped>
.implementation-time { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; font-size: 11px; color: var(--text); }
.over { color: var(--accent-amber, #946000); }
.under { color: var(--accent-green, #187c66); }
</style>
