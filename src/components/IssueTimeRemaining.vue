<script setup lang="ts">
import { computed } from "vue";
import { Clock3 } from "@lucide/vue";
import { useIssueForecast } from "../composables/useIssueForecast";
import { useIssueClock } from "../composables/useIssueClock";
import { estimateLabel } from "../lib/estimates";
import { useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";

const props = defineProps<{ issue: Issue; repository?: string; active?: boolean; bar?: boolean }>();
const { t } = useLanguage();
const { estimate } = useIssueForecast({
  get issue() { return props.issue; }, get repository() { return props.repository; },
  get active() { return props.active; }, inProgress: true,
});
const now = useIssueClock(() => props.issue, () => "progress", () => props.active !== false);
const remaining = computed(() => estimate.value?.remainingMs == null ? null : estimate.value);
const overtimeMs = computed(() => {
  if (!remaining.value?.overdue || !props.issue.startedAt) return 0;
  const started = Date.parse(props.issue.startedAt);
  return Number.isFinite(started) ? Math.max(0, now.value - started - remaining.value.totalMs) : 0;
});
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
  t("Längre än uppskattat"),
].join(". ") : [
  t("Uppskattad tid: {time}", { time: estimateLabel(remaining.value.totalMs) }),
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
