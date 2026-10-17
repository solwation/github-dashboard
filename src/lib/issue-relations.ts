export interface SubIssueProgress { total: number; completed: number }
export interface ParentIssue { number: number; title: string; url: string; repository: string }
export interface IssueRelations { parent: ParentIssue | null; progress: SubIssueProgress | null }
export const issueRelationsQuery = `query IssueRelations($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      parent { number title url }
      subIssuesSummary { total completed }
    }
  }
}`;
export function subIssueProgress(value: unknown): SubIssueProgress | null {
  if (!value || typeof value !== "object") return null;
  const { total, completed } = value as SubIssueProgress;
  return Number.isSafeInteger(total) && Number.isSafeInteger(completed) && total > 0 && completed >= 0 && completed <= total
    ? { total, completed } : null;
}
export function parseIssueRelations(value: unknown): IssueRelations | null {
  const response = value as { data?: { repository?: { issue?: { parent?: unknown; subIssuesSummary?: unknown } } }; errors?: { path?: (string | number)[] }[] } | null;
  const issue = response?.data?.repository?.issue;
  if (!issue) return null;
  // Partial GraphQL failures must not hide independently available fields.
  const failed = (field: string) => response?.errors?.some(error => !error.path || error.path.length <= 2 || error.path.includes(field));
  let parent: ParentIssue | null = null;
  if (!failed("parent") && issue.parent && typeof issue.parent === "object") {
    const candidate = issue.parent as ParentIssue;
    try {
      const url = new URL(candidate.url);
      const path = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/);
      if (url.origin === "https://github.com" && !url.username && !url.password && path &&
        Number.isSafeInteger(candidate.number) && candidate.number > 0 && Number(path[2]) === candidate.number &&
        typeof candidate.title === "string" && candidate.title.trim()) {
        parent = { number: candidate.number, title: candidate.title, url: url.href, repository: path[1]! };
      }
    } catch { /* Invalid or inaccessible parent links stay hidden. */ }
  }
  return { parent, progress: failed("subIssuesSummary") ? null : subIssueProgress(issue.subIssuesSummary) };
}

/**
 * GraphQL cannot be revalidated with ETags and always costs rate limit. Entries are keyed by the
 * issue's updated_at and sub_issues_summary, so relation changes on the issue itself refetch at once;
 * the long TTL only bounds staleness of the parent's title. A full or manual refresh clears the cache (#123).
 */
export const RELATIONS_TTL_MS = 600_000;
/** Account-local, bounded cache; only visible cards request metadata, at most three at once. */
export class IssueRelationsCache {
  private entries = new Map<string, { at: number; pending: boolean; result: Promise<IssueRelations | null> }>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private fetchRelations: (repository: string, number: number) => Promise<IssueRelations | null>) {}
  clear() { this.entries.clear(); }
  get(repository: string, issue: { id: number; number: number; updated_at: string; sub_issues_summary?: unknown }) {
    const key = JSON.stringify([repository, issue.id, issue.number, issue.updated_at, issue.sub_issues_summary]);
    const previous = this.entries.get(key);
    if (previous && (previous.pending || Date.now() - previous.at < RELATIONS_TTL_MS)) return previous.result;
    const entry = { at: Date.now(), pending: true, result: Promise.resolve<IssueRelations | null>(null) };
    entry.result = this.run(repository, issue.number).catch(() => null).finally(() => { entry.pending = false; entry.at = Date.now(); });
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > 300) this.entries.delete(this.entries.keys().next().value!);
    return entry.result;
  }
  private async run(repository: string, number: number) {
    if (this.active >= 3) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await this.fetchRelations(repository, number); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
}
