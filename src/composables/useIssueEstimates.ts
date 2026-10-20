import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue";
import type { Issue, Rules } from "../lib/model";
import { nextHistoryExpiry, repositoryEstimate, type EstimateBasis } from "../lib/estimates";
import { useNow } from "./useNow";

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
}

export function useIssueEstimateBasis(repository: () => string | undefined) {
  const bases = inject(issueEstimatesKey, undefined);
  return computed(() => bases?.value.get(repository() ?? ""));
}
