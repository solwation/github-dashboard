import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from "vue";
import { subIssueProgress, type IssueRelations } from "../lib/issue-relations";
import type { Issue } from "../lib/model";

export function useIssueRelations(
  issue: () => Issue,
  visible: () => boolean,
  load?: () => ((issue: Issue) => Promise<IssueRelations | null>) | undefined,
  session?: () => number | undefined,
  revision?: () => number | undefined,
  demo?: () => boolean | undefined,
) {
  const relations = ref<IssueRelations | null>(null);
  let run = 0;
  const restProgress = computed(() => subIssueProgress(issue().sub_issues_summary));
  const progress = computed(() => issue().sub_issues_summary?.total === 0 ? null : restProgress.value ?? relations.value?.progress ?? null);
  const isSubtask = computed(() => Boolean(relations.value?.parent));
  const parent = computed(() => relations.value?.parent ?? null);

  async function loadData() {
    const current = ++run;
    const loader = load?.();
    if (!visible() || !loader || demo?.()) return;
    try {
      const result = await loader(issue());
      if (current === run) relations.value = result;
    } catch {
      if (current === run) relations.value = null;
    }
  }

  watch([() => issue().id, () => issue().html_url, () => session?.()], () => {
    run++;
    relations.value = null;
  }, { flush: "sync" });

  watch([
    () => visible(),
    () => issue().id,
    () => issue().html_url,
    () => issue().updated_at,
    () => issue().sub_issues_summary?.total,
    () => issue().sub_issues_summary?.completed,
    () => session?.(),
    () => revision?.(),
  ], () => { void loadData(); }, { immediate: true });

  if (getCurrentInstance()) onBeforeUnmount(() => { run++; });

  return { relations, progress, isSubtask, parent };
}
