import type { Issue, Lane } from "./model";

const sameJson = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** GitHub bumps `updated_at` on every issue edit; the remaining fields are local enrichment. */
function sameIssue(a: Issue, b: Issue) {
  return a === b || (a.id === b.id && a.updated_at === b.updated_at && a.state === b.state &&
    (a.startedAt ?? null) === (b.startedAt ?? null) && !!a.timerError === !!b.timerError &&
    sameJson(a.sub_issues_summary ?? null, b.sub_issues_summary ?? null));
}

/**
 * True when a freshly synced lane shows exactly what the board already shows (#122), so the
 * previous lane object can be kept: no shallowRef trigger, re-render or encrypted cache write.
 */
export function sameLaneContent(previous: Lane | undefined, next: Lane): previous is Lane {
  if (!previous || previous === next) return previous === next;
  if (previous.loading || next.loading || previous.error || next.error || !!previous.timerWarning !== !!next.timerWarning) return false;
  if (previous.issues.length !== next.issues.length || previous.labels.length !== next.labels.length) return false;
  if (!previous.issues.every((issue, index) => sameIssue(issue, next.issues[index]!))) return false;
  return sameJson(previous.labels, next.labels) && sameJson(previous.repo, next.repo);
}

/** Element-wise identity: lanes are replaced, never mutated (#121), so identity means unchanged. */
export function sameLaneList(a: readonly Lane[], b: readonly Lane[]) {
  return a.length === b.length && a.every((lane, index) => lane === b[index]);
}
