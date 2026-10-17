<script setup lang="ts">
import { computed } from "vue";
import { useLanguage } from "../lib/i18n";
import type { Issue, Rules } from "../lib/model";
import { combinedEstimate, estimateLabel, repositoryEstimate } from "../lib/estimates";
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
    if (!only || !value || only.basis.typicalMs === null) return null;
    return { value, overdue: only.progress?.overdue ?? 0, counting: counting(only.progress), basis: t("Median {typical} för {count} stängda ärenden senaste {days} dagarna.", {
      typical: estimateLabel(only.basis.typicalMs).replace(/^≈\s*/, ""), count: only.basis.samples, days: only.basis.windowDays,
    }) + (props.column === "backlog" ? " " + t("Backlog delas med {parallel} samtidigt pågående i snitt.", { parallel: only.basis.parallelism.toFixed(1) }) : "") };
  }
  const combined = combinedEstimate(repositories);
  const value = combined && (props.column === "progress" ? combined.progress : combined.backlog);
  if (!combined || !value) return null;
  return { value, overdue: combined.progress?.overdue ?? 0, counting: repositories.some((r) => counting(r.progress)), basis: t("Median per repository från {count} stängda ärenden i {repositories} repositories senaste {days} dagarna. Långsammaste repository avgör.", {
    count: combined.samples, repositories: combined.repositories, days: combined.windowDays,
  }) };
}
/** Whether some issue is still counting down; otherwise the value only changes with new data. */
function counting(progress: ReturnType<typeof repositoryEstimate>["progress"]) {
  return !!progress?.items.some((item) => !item.unknownStart && !item.overdue);
}

// Minute precision: wake when the rounded label can change, i.e. when the remaining time crosses
// a half minute. Data changes rerun the clock because `delay` reads the props.
const now = useNow((at) => {
  const current = estimateAt(at);
  if (!current?.counting) return Infinity;
  return ((current.value.remainingMs - MINUTE / 2) % MINUTE + MINUTE) % MINUTE || MINUTE;
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
