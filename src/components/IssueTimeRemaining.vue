<script setup lang="ts">
import { computed } from "vue";
import { Clock3 } from "@lucide/vue";
import { useIssueForecast } from "../composables/useIssueForecast";
import { useNow, untilNext } from "../composables/useNow";
import { estimateLabel } from "../lib/estimates";
import { useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";

// `inProgress: false` is a Backlog parent whose sub-issue work has started (#281).
const props = withDefaults(defineProps<{ issue: Issue; repository?: string; active?: boolean; bar?: boolean; inProgress?: boolean }>(), { inProgress: true });
const { t } = useLanguage();
const { estimate, estimateAt } = useIssueForecast({
  get issue() { return props.issue; }, get repository() { return props.repository; },
  get active() { return props.active; }, get inProgress() { return props.inProgress; },
});
// Overtime grows while the issue or one of its sub-issues runs: wake when it starts and at each
// rounded minute change of the overtime label.
const now = useNow(at => {
  const current = estimateAt(at);
  if (!current?.running || current.remainingMs === null) return Infinity;
  return current.overdue ? untilNext(current.overtimeMs + 30000, 60000) : current.remainingMs + 1;
}, { board: true, active: () => props.active !== false });
const remaining = computed(() => estimate.value?.remainingMs == null ? null : estimate.value);
const overtimeMs = computed(() => remaining.value?.overdue ? estimateAt(now.value)?.overtimeMs ?? 0 : 0);
const deducted = computed(() => remaining.value && remaining.value.subIssueSpentMs > 0
  ? [t("Tid på underärenden avdragen: {time}", { time: estimateLabel(remaining.value.subIssueSpentMs) })] : []);
const overtimeLabel = computed(() => estimateLabel(overtimeMs.value).replace(/^≈\s*/, ""));
const label = computed(() => !remaining.value ? "" : remaining.value.overdue
  ? overtimeLabel.value : t("{time} kvar", { time: estimateLabel(remaining.value.remainingMs!) }));
const percent = computed(() => !remaining.value ? 0 : Math.min(100, Math.max(0,
  (1 - remaining.value.remainingMs! / remaining.value.totalMs) * 100)));
const description = computed(() => !remaining.value ? "" : remaining.value.overdue ? [
  t("Faktisk arbetstid hittills: {time}", { time: estimateLabel(remaining.value.totalMs + overtimeMs.value) }),
  t("Övertid: {time} över uppskattningen på {estimate}", {
    time: overtimeLabel.value,
    estimate: estimateLabel(remaining.value.totalMs),
  }),
  ...deducted.value,
  t("Längre än uppskattat"),
].join(". ") : [
  t("Uppskattad tid: {time}", { time: estimateLabel(remaining.value.totalMs) }),
  ...deducted.value,
  t("Uppskattad tid kvar: {time}", { time: estimateLabel(remaining.value.remainingMs!) }),
].join(". "));
</script>
<template>
  <span v-if="remaining" class="issue-time-remaining" :class="{ 'issue-time-progress': bar, overdue: remaining.overdue }" :title="description">
    <span class="issue-time-remaining-label" :aria-label="description">
      <template v-if="remaining.overdue"><Clock3 :size="12" aria-hidden="true" />{{ label }}<span aria-hidden="true"> ↑</span></template>
      <template v-else>{{ label }}</template>
    </span>
    <span v-if="bar" class="issue-time-track" role="progressbar" :aria-label="t('Förfluten andel av uppskattad tid')"
      :aria-valuenow="Math.round(percent)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="description">
      <span class="issue-time-fill" :style="{ width: percent + '%' }" />
    </span>
  </span>
</template>
<style scoped>
.issue-time-remaining-label { display: inline-flex; align-items: center; gap: 2px; }
</style>
