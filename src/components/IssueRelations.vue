<script setup lang="ts">
import { useLanguage } from "../lib/i18n";
import { useIssueRelations } from "../composables/useIssueRelations";
import type { IssueRelations } from "../lib/issue-relations";
import type { Issue } from "../lib/model";
const props = defineProps<{
  issue: Issue; repository: string; visible: boolean; session?: number; revision?: number;
  load?: (issue: Issue) => Promise<IssueRelations | null>;
}>();
const { t } = useLanguage();
const emit = defineEmits<{ parentSelect: [repository: string, number: number] }>();
const { relations } = useIssueRelations(
  () => props.issue,
  () => props.visible,
  () => props.load,
  () => props.session,
  () => props.revision,
);
</script>
<template>
  <div v-if="relations?.parent" class="issue-relations">
    <div v-if="relations?.parent" class="issue-parent">
      <span>{{ t("Överordnat ärende") }}</span>
      <button type="button" :title="relations.parent.title" @click="emit('parentSelect', relations.parent.repository, relations.parent.number)">
        {{ relations.parent.repository.toLowerCase() === repository.toLowerCase() ? '' : relations.parent.repository }}#{{ relations.parent.number }} · {{ relations.parent.title }}
      </button>
    </div>
  </div>
</template>
<style scoped>
.issue-relations { display: grid; gap: .65rem; margin: .75rem 0; min-width: 0; padding-top: .65rem; border-top: 1px solid var(--line); font-size: .72rem; }
.issue-parent { display: grid; gap: .25rem; min-width: 0; }
.issue-parent > span { color: var(--muted); }
.issue-parent button { justify-self: start; max-width: 100%; padding: 0; border: 0; background: transparent; color: var(--green); font: inherit; text-align: left; text-decoration: underline; overflow-wrap: anywhere; line-height: 1.5; cursor: pointer; }
.issue-parent button:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
</style>
