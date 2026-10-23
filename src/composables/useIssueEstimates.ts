import { computed, inject, provide, shallowRef, watchEffect, type ComputedRef, type InjectionKey } from "vue";
import { column, type Issue, type Rules } from "../lib/model";
import { closedIssueGroupOutcome, closedIssueOutcome, ESTIMATE_WINDOW_DAYS, historySamples, MAX_HISTORY_SAMPLES, nextHistoryExpiry, repositoryEstimate, subIssueGroupWork, type EstimateBasis, type HistorySample, type SubIssueGroupWork, type SubIssueWork } from "../lib/estimates";
import { useNow } from "./useNow";
import { useSubIssues } from "./useSubIssues";
import { provideSubIssueWork } from "./useSubIssueWork";

interface GroupScope { rules: Rules; members: Map<number, Issue>; children: ReadonlyMap<number, readonly SubIssueWork[]> }
const groupScopeKey: InjectionKey<ComputedRef<Map<string, GroupScope>>> = Symbol("issue-group-scope");

const outcomeKey: InjectionKey<ComputedRef<{ now: number; histories: Map<string, HistorySample[]> }>> = Symbol("issue-outcomes");

type Group = { issues: Issue[]; rules?: Rules };
const issueEstimatesKey: InjectionKey<ComputedRef<Map<string, EstimateBasis>>> = Symbol("issue-estimates");

/** Shared repository calibration, refreshed with filtered data or history expiry, never per issue tick. */
export function provideIssueEstimates(groups: () => Map<string, Group[]>) {
  const now = useNow(at => Math.min(86400000, ...[...groups().values()].flatMap(entries => entries.map(group => {
    const expiry = nextHistoryExpiry(group.issues, at, { rules: group.rules, sampleLimit: MAX_HISTORY_SAMPLES + 1 });
    return expiry === null ? Infinity : expiry - at;
  }))), { board: true });
  const bases = computed(() => new Map([...groups()].flatMap(([repository, entries]) => {
    const group = entries[0];
    return group ? [[repository, repositoryEstimate(group.issues, now.value, { rules: group.rules }).basis] as const] : [];
  })));
  provide(issueEstimatesKey, bases);
  // Sub-issues the column/overview badges already loaded, plus each repository's open estimated
  // issues, so a parent's card can apply the same group rule (#281).
  const children = provideSubIssueWork();
  provide(groupScopeKey, computed(() => new Map([...groups()].flatMap(([repository, entries]) => {
    const group = entries[0];
    if (!group) return [];
    const rules = group.rules ?? {};
    const members = new Map(group.issues.filter(issue => {
      if (issue.pull_request) return false;
      const state = column(issue, rules);
      return state === "progress" || state === "backlog";
    }).map(issue => [issue.id, issue] as const));
    return [[repository, { rules, members, children: children.value }] as const];
  }))));
  provide(outcomeKey, computed(() => ({ now: now.value, histories: new Map([...groups()].flatMap(([repo, entries]) => {
    const group = entries[0];
    return group ? [[repo, historySamples(group.issues, now.value, { rules: group.rules, sampleLimit: MAX_HISTORY_SAMPLES + 1 })] as const] : [];
  })) })));

}

export function useIssueEstimateBasis(repository: () => string | undefined) {
  const bases = inject(issueEstimatesKey, undefined);
  return computed(() => bases?.value.get(repository() ?? ""));
}

/**
 * Sub-issue work below this issue at a given time, using only sub-issues the badges already
 * loaded; null until they are loaded or when the issue is not an open estimated parent.
 */
export function useIssueGroupWork(issue: () => Issue, repository: () => string | undefined) {
  const scopes = inject(groupScopeKey, undefined);
  const basis = useIssueEstimateBasis(repository);
  return (at: number): SubIssueGroupWork | null => {
    const current = issue(), scope = scopes?.value.get(repository() ?? "");
    if (!scope || !(current.sub_issues_summary?.total) || !scope.members.has(current.id) || !scope.children.has(current.id)) return null;
    return subIssueGroupWork(current, scope.members, at, scope.rules, basis.value?.windowDays ?? ESTIMATE_WINDOW_DAYS, scope.children);
  };
}

export function useClosedIssueOutcome(issue: () => Issue, repository: () => string | undefined) {
  const context = inject(outcomeKey, undefined);
  const relations = useSubIssues();
  const loaded = shallowRef<{ key: string; children: Issue[] | null }>();
  let run = 0;
  watchEffect(onCleanup => {
    const current = issue(), repo = repository(), total = current.sub_issues_summary?.total ?? 0;
    if (!repo || total < 1 || !relations) return;
    const key = `${repo.toLowerCase()}:${current.id}:${current.updated_at}:${relations.revision(repo)}`;
    const request = ++run;
    let active = true;
    onCleanup(() => { active = false; });
    void relations.load(repo, current).catch(() => null).then(values => {
      if (!active || request !== run) return;
      loaded.value = { key, children: values?.map(value => relations.known(value.repository, value.issue.id) ?? value.issue) ?? null };
    });
  });
  return computed(() => {
    const current = issue(), repo = repository(), histories = context?.value.histories.get(repo ?? "") ?? [], now = context?.value.now ?? Date.now();
    const total = current.sub_issues_summary?.total ?? 0;
    if (total < 1) return closedIssueOutcome(current, histories, now);
    if (!repo || !relations) return null;
    const key = `${repo.toLowerCase()}:${current.id}:${current.updated_at}:${relations.revision(repo)}`;
    const children = loaded.value?.key === key ? loaded.value.children : undefined;
    if (!children || children.length !== total) return null;
    return closedIssueGroupOutcome(current, children, histories, now);
  });
}
