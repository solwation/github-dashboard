import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import type { Issue, Rules } from "../lib/model";
import { closedIssueOutcome, historySamples, MAX_HISTORY_SAMPLES, nextHistoryExpiry, repositoryEstimate, type EstimateBasis, type HistorySample } from "../lib/estimates";
import { useNow } from "./useNow";

const outcomeKey: InjectionKey<ComputedRef<{ now: number; histories: Map<string, HistorySample[]> }>> = Symbol("issue-outcomes");

type Group = { issues: Issue[]; rules?: Rules };
const issueEstimatesKey: InjectionKey<ComputedRef<Map<string, EstimateBasis>>> = Symbol("issue-estimates");

/** Shared repository calibration, refreshed with filtered data or history expiry, never per issue tick. */
export function provideIssueEstimates(groups: () => Map<string, Group[]>) {
  const now = useNow(at => Math.min(86400000, ...[...groups().values()].flatMap(entries => entries.map(group => {
    const expiry = nextHistoryExpiry(group.issues, at, { rules: group.rules });
    return expiry === null ? Infinity : expiry - at;
  }))), { board: true });
  const bases = computed(() => new Map([...groups()].flatMap(([repository, entries]) => {
    const group = entries[0];
    return group ? [[repository, repositoryEstimate(group.issues, now.value, { rules: group.rules }).basis] as const] : [];
  })));
  provide(issueEstimatesKey, bases);
  provide(outcomeKey, computed(() => ({ now: now.value, histories: new Map([...groups()].flatMap(([repo, entries]) => {
    const group = entries[0];
    return group ? [[repo, historySamples(group.issues, now.value, { rules: group.rules, sampleLimit: MAX_HISTORY_SAMPLES + 1 })] as const] : [];
  })) })));

}

export function useIssueEstimateBasis(repository: () => string | undefined) {
  const bases = inject(issueEstimatesKey, undefined);
  return computed(() => bases?.value.get(repository() ?? ""));
}

export function useClosedIssueOutcome(issue: () => Issue, repository: () => string | undefined) {
  const context = inject(outcomeKey, undefined);
  return computed(() => closedIssueOutcome(issue(), context?.value.histories.get(repository() ?? "") ?? [], context?.value.now ?? Date.now()));
}
