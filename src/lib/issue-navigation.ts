/**
 * Notification clicks (#278) lead back to one issue on the Overview board. A worker-shown
 * notice cannot call into the page, so it carries the target as `#repo-<id>-issue-<number>`.
 */
export interface IssueNavigationTarget { repoId: number; number: number }

export function issueNavigationHash({ repoId, number }: IssueNavigationTarget): string {
  return `#repo-${repoId}-issue-${number}`;
}

export function parseIssueNavigationHash(hash: string): IssueNavigationTarget | null {
  const match = /^#repo-(\d+)-issue-(\d+)$/.exec(hash);
  if (!match) return null;
  const repoId = Number(match[1]), number = Number(match[2]);
  return Number.isSafeInteger(repoId) && Number.isSafeInteger(number) && number > 0 ? { repoId, number } : null;
}
