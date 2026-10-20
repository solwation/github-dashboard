<script setup lang="ts">
import { computed } from "vue";
import { useIssueForecast } from "../composables/useIssueForecast";
import { estimateLabel } from "../lib/estimates";
import { useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";

const props = defineProps<{ issue: Issue; repository?: string; active?: boolean; bar?: boolean }>();
const { t } = useLanguage();
const { estimate } = useIssueForecast({
  get issue() { return props.issue; }, get repository() { return props.repository; },
  get active() { return props.active; }, inProgress: true,
});
const remaining = computed(() => estimate.value?.remainingMs == null ? null : estimate.value);
const label = computed(() => !remaining.value ? "" : remaining.value.overdue
  ? t("över uppskattning") : t("{time} kvar", { time: estimateLabel(remaining.value.remainingMs!) }));
const percent = computed(() => !remaining.value ? 0 : Math.min(100, Math.max(0,
  (1 - remaining.value.remainingMs! / remaining.value.totalMs) * 100)));
const description = computed(() => !remaining.value ? "" : [
  t("Uppskattad tid: {time}", { time: estimateLabel(remaining.value.totalMs) }),
  remaining.value.overdue ? t("Uppskattad tid kvar: över uppskattning")
    : t("Uppskattad tid kvar: {time}", { time: estimateLabel(remaining.value.remainingMs!) }),
].join(". "));
</script>
<template>
  <span v-if="remaining" class="issue-time-remaining" :class="{ 'issue-time-progress': bar, overdue: remaining.overdue }" :title="description">
    <span class="issue-time-remaining-label" :aria-label="bar ? undefined : description">{{ label }}</span>
    <span v-if="bar" class="issue-time-track" role="progressbar" :aria-label="t('Förfluten andel av uppskattad tid')"
      :aria-valuenow="Math.round(percent)" :aria-valuemin="0" :aria-valuemax="100" :aria-valuetext="description">
      <span class="issue-time-fill" :style="{ width: percent + '%' }" />
    </span>
  </span>
</template>
