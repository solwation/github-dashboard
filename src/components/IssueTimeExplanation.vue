<script setup lang="ts">
import { computed } from "vue";
import { useIssueForecast } from "../composables/useIssueForecast";
import { useClosedIssueOutcome } from "../composables/useIssueEstimates";
import { useIssueClock } from "../composables/useIssueClock";
import { approximatePoints } from "../lib/story-points";
import { estimateLabel } from "../lib/estimates";
import { duration } from "../lib/model";
import { locale, useLanguage } from "../lib/i18n";
import type { Issue } from "../lib/model";

const props = defineProps<{ issue: Issue; repository?: string; column: "backlog" | "progress" | "closed" }>();
const { t } = useLanguage();
const { basis, estimate } = useIssueForecast({
  get issue() { return props.issue; },
  get repository() { return props.repository; },
  inProgress: props.column === "progress",
  active: true,
});
const outcome = useClosedIssueOutcome(() => props.issue, () => props.repository);
const now = useIssueClock(() => props.issue, () => props.column, () => true);
const points = computed(() => approximatePoints(props.issue));
const elapsed = computed(() => props.issue.startedAt ? duration(props.issue.startedAt, now.value) : null);
const actual = computed(() => outcome.value ? estimateLabel(outcome.value.actualMs).replace(/^≈\s*/, "") : null);
const aggregation = computed(() => {
  if (!outcome.value || !("aggregation" in outcome.value) || !outcome.value.aggregation) return null;
  return locale.value === "sv-SE"
    ? outcome.value.aggregation === "sum" ? "Summan av parentens och alla subtasks arbetstid" : "Gruppens spann från första kända start till sista stängning"
    : outcome.value.aggregation === "sum" ? "Sum of the parent and all subtasks' work time" : "Group span from the earliest known start to the final closure";
});
const comparison = computed(() => outcome.value?.estimatedMs == null ? null : {
  estimate: estimateLabel(outcome.value.estimatedMs),
  direction: Math.sign(outcome.value.actualMs - outcome.value.estimatedMs),
});
const remaining = computed(() => estimate.value?.remainingMs == null ? null : estimate.value.overdue
  ? t("över uppskattning") : estimateLabel(estimate.value.remainingMs));
</script>

<template>
  <details class="time-explanation">
    <summary>{{ t("Förklara tid och story points") }}</summary>
    <div class="time-explanation-body">
      <dl>
        <div><dt>{{ t("Story points") }}</dt><dd>≈ {{ points }} SP</dd></div>
        <div v-if="estimate"><dt>{{ t("Total uppskattning") }}</dt><dd>{{ estimateLabel(estimate.totalMs) }}</dd></div>
        <div v-if="column === 'progress' && elapsed"><dt>{{ t("Förfluten arbetstid") }}</dt><dd>{{ elapsed }}</dd></div>
        <div v-if="column === 'progress' && remaining"><dt>{{ t("Kvar / över") }}</dt><dd>{{ remaining }}</dd></div>
        <div v-if="actual"><dt>{{ t("Faktisk arbetstid") }}</dt><dd>{{ actual }}</dd></div>
        <div v-if="aggregation"><dt>{{ locale === "sv-SE" ? "Beräkning" : "Calculation" }}</dt><dd>{{ aggregation }}</dd></div>
        <div v-if="comparison"><dt>{{ t("Jämförelse med historik") }}</dt><dd>
          <span aria-hidden="true">{{ comparison.direction > 0 ? "↑" : comparison.direction < 0 ? "↓" : "=" }} </span>
          {{ comparison.direction > 0 ? t("Längre än uppskattat") : comparison.direction < 0 ? t("Kortare än uppskattat") : t("Enligt uppskattning") }} ({{ comparison.estimate }})
        </dd></div>
      </dl>
      <p>{{ t("Story points är en grov storleksindikator, inte uppmätt komplexitet. En entydig poängetikett används först; annars uppskattas storleken lokalt från titel och beskrivning.") }}</p>
      <p v-if="basis?.samples && basis.msPerPoint">{{ t("Tidsestimatet är ungefärligt: punktstorlek multipliceras med median tid per poäng från {count} användbara stängningar i detta repository under {days} dagar.", { count: basis.samples, days: basis.windowDays }) }}</p>
      <p v-if="comparison">{{ t("Om en pil visas betyder ↑ längre och ↓ kortare faktisk arbetstid än ett estimat som räknas nu från andra nyligen stängda ärenden. Det är inte ett sparat ursprungligt löfte.") }}</p>
      <p v-if="column === 'progress'">{{ t("Förfluten tid räknas från den registrerade starten. Kvar är total uppskattning minus förfluten tid; när den passerats visas över uppskattning.") }}</p>
      <p v-if="column === 'closed' && !aggregation">{{ t("Faktisk arbetstid räknas från registrerad arbetsstart till stängning.") }}</p>
    </div>
  </details>
</template>

<style scoped>
.time-explanation { margin-top: .45rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; }
.time-explanation summary { display: flex; align-items: center; min-height: 45px; padding: 0 .5rem; cursor: pointer; color: var(--text); font-weight: 600; }
.time-explanation summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.time-explanation-body { padding: 0 .5rem .5rem; line-height: 1.45; }
.time-explanation-body p { margin: .4rem 0 0; }
.time-explanation-body dl { margin: 0; }
.time-explanation-body dl > div { display: flex; justify-content: space-between; gap: .75rem; padding: .15rem 0; }
.time-explanation-body dt { font-weight: 600; }
.time-explanation-body dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
</style>
