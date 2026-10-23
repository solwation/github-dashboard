import { computed, inject, onScopeDispose, provide, shallowRef, watchEffect, type ComputedRef, type InjectionKey } from "vue";
import { repositoryEstimate, type SubIssueWork } from "../lib/estimates";
import { column, type Issue, type Rules } from "../lib/model";
import { issueRepository, type SubIssue } from "../lib/sub-issues";
import { useSubIssues } from "./useSubIssues";

type Group = { issues: Issue[]; rules?: Rules };
type WorkMap = Map<number, SubIssueWork[]>;
const registryKey: InjectionKey<(work: ComputedRef<WorkMap>) => () => void> = Symbol("sub-issue-work");

/**
 * Collects what every mounted useSubIssueWork (column and overview badges) has already loaded,
 * so a parent's own card can apply the badge's group rule (#281) without any request of its own.
 */
export function provideSubIssueWork(): ComputedRef<ReadonlyMap<number, readonly SubIssueWork[]>> {
  const sources = shallowRef<ComputedRef<WorkMap>[]>([]);
  provide(registryKey, work => {
    sources.value = [...sources.value, work];
    return () => { sources.value = sources.value.filter(source => source !== work); };
  });
  return computed(() => {
    const merged: WorkMap = new Map();
    for (const source of sources.value) for (const [id, children] of source.value) if (!merged.has(id)) merged.set(id, children);
    return merged;
  });
}

/**
 * Direct sub-issues of open estimated parents, keyed by parent id, so column and overview
 * estimates can deduct sub-issue time from the parent (#279). Loads only for repositories
 * that actually show an estimate, reusing the shared lazy sub-issue cache; child state comes
 * from the board copy when known so start times and moves stay current without refetching.
 */
export function useSubIssueWork(groups: () => readonly Group[]) {
  const relations = useSubIssues();
  const loaded = shallowRef(new Map<string, SubIssue[]>());
  const parents = computed(() => {
    if (!relations) return [];
    const now = Date.now();
    return groups().flatMap(group => {
      const candidates = group.issues.filter(issue => !issue.pull_request && issue.state === "open" &&
        (issue.sub_issues_summary?.total ?? 0) > 0 && column(issue, group.rules ?? {}) !== "closed");
      if (!candidates.length || repositoryEstimate(group.issues, now, { rules: group.rules }).basis.msPerPoint === null) return [];
      return candidates.flatMap(issue => {
        const repository = issueRepository(issue);
        return repository ? [{ repository, issue, key: `${repository.toLowerCase()}:${issue.id}:${issue.updated_at}:${relations.revision(repository)}` }] : [];
      });
    });
  });
  let run = 0;
  watchEffect(onCleanup => {
    const wanted = parents.value, request = ++run;
    let active = true;
    onCleanup(() => { active = false; });
    if (!relations || !wanted.length) { if (loaded.value.size) loaded.value = new Map(); return; }
    void Promise.all(wanted.map(async ({ repository, issue, key }) => [key, await relations.load(repository, issue).catch(() => null)] as const))
      .then(results => {
        if (!active || request !== run) return;
        loaded.value = new Map(results.flatMap(([key, values]) => values ? [[key, values] as const] : []));
      });
  });
  const result = computed(() => {
    const result: WorkMap = new Map();
    if (!relations) return result;
    for (const { issue, key } of parents.value) {
      const values = loaded.value.get(key);
      if (values) result.set(issue.id, values.map(value => ({
        issue: relations.known(value.repository, value.issue.id) ?? value.issue, rules: relations.rules(value.repository),
      })));
    }
    return result;
  });
  const unregister = inject(registryKey, undefined)?.(result);
  if (unregister) onScopeDispose(unregister);
  return result;
}
