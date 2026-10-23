import { computed } from "vue";
import { issueGroupEstimate } from "../lib/estimates";
import type { Issue } from "../lib/model";
import { useIssueEstimateBasis, useIssueGroupWork } from "./useIssueEstimates";
import { useNow } from "./useNow";

/**
 * Repository calibration is shared; only this issue's display wakes at a rounded time change.
 * A parent's forecast deducts its sub-issues' spent time like the column badges (#281), once
 * those sub-issues have loaded; until then it shows the issue's own forecast.
 */
export function useIssueForecast(props: { issue: Issue; repository?: string; inProgress?: boolean; active?: boolean }) {
  const basis = useIssueEstimateBasis(() => props.repository);
  const groupWork = useIssueGroupWork(() => props.issue, () => props.repository);
  const estimateAt = (at: number) => issueGroupEstimate(props.issue, basis.value?.msPerPoint, at, !!props.inProgress, groupWork(at));
  const now = useNow(at => {
    const estimate = estimateAt(at);
    if (!estimate || estimate.remainingMs === null || !estimate.counting) return Infinity;
    const remaining = estimate.remainingMs;
    const roundedChange = ((remaining - 30000) % 60000 + 60000) % 60000 || 60000;
    return Math.min(roundedChange, remaining || 1);
  }, { board: true, active: () => props.active !== false });
  return { basis, estimateAt, estimate: computed(() => estimateAt(now.value)) };
}
