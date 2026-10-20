import { computed } from "vue";
import { issueEstimate } from "../lib/estimates";
import type { Issue } from "../lib/model";
import { useIssueEstimateBasis } from "./useIssueEstimates";
import { useNow } from "./useNow";

/** Repository calibration is shared; only this issue's display wakes at a rounded time change. */
export function useIssueForecast(props: { issue: Issue; repository?: string; inProgress?: boolean; active?: boolean }) {
  const basis = useIssueEstimateBasis(() => props.repository);
  const estimateAt = (at: number) => issueEstimate(props.issue, basis.value?.msPerPoint, at, !!props.inProgress);
  const now = useNow(at => {
    const estimate = estimateAt(at);
    if (!estimate || estimate.remainingMs === null || estimate.overdue) return Infinity;
    const remaining = estimate.remainingMs;
    const roundedChange = ((remaining - 30000) % 60000 + 60000) % 60000 || 60000;
    return Math.min(roundedChange, remaining || 1);
  }, { board: true, active: () => props.active !== false });
  return { basis, estimate: computed(() => estimateAt(now.value)) };
}
