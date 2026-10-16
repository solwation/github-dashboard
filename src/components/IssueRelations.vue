<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLanguage } from "../lib/i18n";
import { subIssueProgress, type IssueRelations } from "../lib/issue-relations";
import type { Issue } from "../lib/model";
const props = defineProps<{
  issue: Issue; repository: string; visible: boolean; session?: number; revision?: number;
  load?: (issue: Issue) => Promise<IssueRelations | null>;
}>();
const { t } = useLanguage();
const relations = ref<IssueRelations | null>(null);
let run = 0;
const restProgress = computed(() => subIssueProgress(props.issue.sub_issues_summary));
// REST provides a current summary even when GraphQL access is unavailable.
const progress = computed(() => props.issue.sub_issues_summary?.total === 0 ? null : restProgress.value ?? relations.value?.progress ?? null);
const percent = computed(() => progress.value ? Math.round(progress.value.completed / progress.value.total * 100) : 0);
const label = computed(() => progress.value ? t("{completed} av {total} underärenden stängda", { completed: progress.value.completed, total: progress.value.total }) : "");
async function load() {
  const current = ++run;
  if (!props.visible || !props.load) return;
  try {
    const result = await props.load(props.issue);
    if (current === run) relations.value = result;
  } catch { if (current === run) relations.value = null; }
}
watch([() => props.issue.id, () => props.issue.html_url, () => props.session], () => {
  run++; relations.value = null;
}, { flush: "sync" });
watch([() => props.visible, () => props.issue.id, () => props.issue.html_url, () => props.issue.updated_at,
  () => props.issue.sub_issues_summary?.total, () => props.issue.sub_issues_summary?.completed,
  () => props.session, () => props.revision], () => { void load(); }, { immediate: true });
onBeforeUnmount(() => { run++; });
</script>
<template>
  <div v-if="relations?.parent || progress" class="issue-relations">
    <div v-if="relations?.parent" class="issue-parent">
      <span>{{ t("Överordnat ärende") }}</span>
      <a :href="relations.parent.url" target="_blank" rel="noopener noreferrer" :title="relations.parent.title">
        {{ relations.parent.repository.toLowerCase() === repository.toLowerCase() ? '' : relations.parent.repository }}#{{ relations.parent.number }} · {{ relations.parent.title }}
      </a>
    </div>
    <div v-if="progress" class="sub-issue-progress">
      <div class="sub-issue-progress-label"><span>{{ label }}</span><span aria-hidden="true">{{ percent }}%</span></div>
      <progress :value="progress.completed" :max="progress.total" :aria-label="label">{{ percent }}%</progress>
    </div>
  </div>
</template>
<style scoped>
.issue-relations { display: grid; gap: .65rem; margin: .75rem 0; min-width: 0; padding-top: .65rem; border-top: 1px solid var(--line); font-size: .72rem; }
.issue-parent { display: grid; gap: .25rem; min-width: 0; }
.issue-parent > span { color: var(--muted); }
.issue-parent a { color: var(--green); overflow-wrap: anywhere; line-height: 1.5; }
.issue-parent a:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.sub-issue-progress-label { display: flex; justify-content: space-between; gap: .5rem; line-height: 1.5; }
.sub-issue-progress-label > span:first-child { min-width: 0; overflow-wrap: anywhere; }
progress { display: block; width: 100%; height: 6px; margin-top: .35rem; accent-color: var(--green); }
</style>
