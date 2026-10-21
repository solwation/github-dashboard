<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { column, type Issue } from '../lib/model';
import { issueRepository, type SubIssue } from '../lib/sub-issues';
import { useSubIssues } from '../composables/useSubIssues';
import { useLanguage } from '../lib/i18n';
const props = defineProps<{ issue: Issue; session?: number }>();
const context = useSubIssues(), { t } = useLanguage();
const repository = computed(() => issueRepository(props.issue));
const entries = ref<SubIssue[] | null>(null), pending = ref(false);
let run = 0;
watch([() => props.issue.id, () => props.issue.html_url, () => props.issue.updated_at, () => props.issue.sub_issues_summary?.total,
  () => props.issue.sub_issues_summary?.completed, () => props.session, () => repository.value ? context?.revision(repository.value) : 0], async () => {
  const current = ++run;
  entries.value = null; pending.value = false;
  if (!context || !repository.value || props.issue.sub_issues_summary?.total === 0) return;
  pending.value = true;
  try { const result = await context.load(repository.value, props.issue); if (run === current) entries.value = result; }
  catch { /* Optional inaccessible relations remain hidden. */ }
  finally { if (run === current) pending.value = false; }
}, { immediate: true });
onBeforeUnmount(() => { run++; });
const items = computed(() => (entries.value ?? []).map(entry => {
  const known = context?.known(entry.repository, entry.issue.id);
  const issue = known && known.updated_at >= entry.issue.updated_at ? known : entry.issue;
  return { ...entry, issue, status: column(issue, context?.rules(entry.repository) ?? {}) };
}));
</script>
<template>
  <p v-if="pending" class="sub-issues-loading" role="status">{{ t('Hämtar underärenden…') }}</p>
  <section v-else-if="items.length" class="issue-sub-issues" :aria-label="t('Underärenden')">
    <h4>{{ t('Underärenden') }}</h4>
    <ul>
      <li v-for="entry in items" :key="entry.issue.id">
        <a :href="entry.issue.html_url" target="_blank" rel="noopener noreferrer">{{ entry.repository.toLowerCase() === repository?.toLowerCase() ? '' : entry.repository }}#{{ entry.issue.number }} · {{ entry.issue.title }}</a>
        <span class="sub-issue-status" :class="entry.status">{{ entry.status === 'closed' ? 'Closed' : entry.status === 'progress' ? 'In progress' : 'Backlog' }}</span>
      </li>
    </ul>
  </section>
</template>
<style scoped>
.issue-sub-issues { margin-top: .8rem; border-top: 1px solid var(--line); padding-top: .6rem; min-width: 0; font-size: .75rem; }
h4 { margin: 0 0 .4rem; font-size: inherit; }
ul { margin: 0; padding: 0; list-style: none; display: grid; gap: .4rem; }
li { display: flex; align-items: flex-start; gap: .5rem; min-width: 0; }
a { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--green); line-height: 1.5; }
a:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.sub-issue-status { flex: 0 0 auto; font-size: .65rem; border-radius: 4px; padding: 2px 5px; background: var(--line); white-space: nowrap; }
.sub-issue-status.progress { background: #fff1d7; color: #805000; }
.sub-issue-status.closed { background: #e1f3eb; color: #17664d; }
.sub-issues-loading { font-size: .72rem; color: var(--muted); }
</style>
