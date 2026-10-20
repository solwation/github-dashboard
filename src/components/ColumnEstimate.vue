<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";
import type { Issue, Rules } from "../lib/model";
import { combinedEstimate, estimateLabel, MAX_HISTORY_SAMPLES, nextHistoryExpiry, repositoryEstimate } from "../lib/estimates";
import { useNow } from "../composables/useNow";

/**
 * Time estimate in the Backlog and In progress column headers (#138, #140). `groups` holds the
 * already filtered issues of each repository: one group in the split view, one per repository on
 * the combined board, where the slowest repository decides. The component owns its clock, so the
 * countdown never re-renders the App root, and shows nothing without enough history.
 */
const props = defineProps<{ groups: { issues: Issue[]; rules?: Rules }[]; column: "progress" | "backlog" }>();
const { t } = useLanguage();
const MINUTE = 60000;

function estimateAt(at: number) {
  const repositories = props.groups.map((group) => repositoryEstimate(group.issues, at, { rules: group.rules }));
  if (props.groups.length === 1) {
    const [only] = repositories;
    const value = only && (props.column === "progress" ? only.progress : only.backlog);
    if (!only || !value || only.basis.msPerPoint === null) return null;
    return { value, overdue: only.progress?.overdue ?? 0, counting: counting(only.progress), basis: pointBasis(value.points) + " " + t("Median {time} per poäng från de senaste {count} användbara stängningarna inom {days} dagar (högst {max}).", {
      time: estimateLabel(only.basis.msPerPoint).replace(/^≈\s*/, ""), count: only.basis.samples, days: only.basis.windowDays, max: MAX_HISTORY_SAMPLES,
    }) + (props.column === "backlog" ? " " + t("Backlog delas med {parallel} samtidigt pågående i snitt.", { parallel: only.basis.parallelism.toFixed(1) }) : "") };
  }
  const combined = combinedEstimate(repositories);
  const value = combined && (props.column === "progress" ? combined.progress : combined.backlog);
  if (!combined || !value) return null;
  const rates = repositories.flatMap(repo => repo.basis.msPerPoint === null ? [] : [repo.basis.msPerPoint]);
  const low = estimateLabel(Math.min(...rates)).replace(/^≈\s*/, ""), high = estimateLabel(Math.max(...rates)).replace(/^≈\s*/, "");
  return { value, overdue: combined.progress?.overdue ?? 0, counting: repositories.some((r) => counting(r.progress)), basis: pointBasis(value.points) + " " + t("Median per repository: {time} per poäng från {count} användbara stängningar i {repositories} repositories inom {days} dagar, högst {max} senaste per repository. Långsammaste repository avgör.", {
    time: low === high ? low : low + "–" + high, count: combined.samples, repositories: combined.repositories, days: combined.windowDays, max: MAX_HISTORY_SAMPLES,
  }) };
}
function pointBasis(points: number) {
  return t("Grov storlek: {points} poäng från poänglabels eller rensad titel/beskrivning, delmål och risksignaler (1–13 per ärende, inte uppmätt komplexitet).", { points });
}
/** Whether some issue is still counting down; otherwise the value only changes with new data. */
function counting(progress: ReturnType<typeof repositoryEstimate>["progress"]) {
  return !!progress?.items.some((item) => !item.unknownStart && !item.overdue);
}

// Wake at a rounded countdown change or the next sample expiry, including backlog-only boards.
const now = useNow((at) => {
  const current = estimateAt(at);
  if (!current) return Infinity;
  const countdown = current.counting ? ((current.value.remainingMs - MINUTE / 2) % MINUTE + MINUTE) % MINUTE || MINUTE : Infinity;
  const expiry = Math.min(...props.groups.flatMap(group => {
    const next = nextHistoryExpiry(group.issues, at, { rules: group.rules });
    return next === null ? [] : [next - at];
  }));
  // A 30-day expiry exceeds the browser timeout limit; a daily wake is safe and bounded.
  return Math.min(countdown, expiry, 86400000);
}, { board: true });
const estimate = computed(() => estimateAt(now.value));
const text = computed(() => {
  const current = estimate.value;
  if (!current) return "";
  if (props.column === "progress" && current.value.remainingMs === 0 && current.overdue) return t("över uppskattning");
  const label = estimateLabel(current.value.remainingMs);
  return props.column === "progress" ? t("{time} kvar", { time: label }) : label;
});
</script>
<template>
  <span v-if="estimate && text" class="column-estimate" :title="estimate.basis" data-testid="column-estimate"
    ><span class="column-estimate-separator" aria-hidden="true">·</span>{{ text }}<span class="sr-only">. {{ estimate.basis }}</span></span
  >
</template>
