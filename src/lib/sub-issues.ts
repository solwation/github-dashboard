import type { Issue } from './model';
import { RELATIONS_TTL_MS } from './issue-relations';
export interface SubIssue { repository: string; issue: Issue }
export function issueRepository(issue: Pick<Issue, 'html_url' | 'number'>): string | null {
  try {
    const url = new URL(issue.html_url), match = url.pathname.match(/^\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?$/);
    return url.origin === 'https://github.com' && !url.username && !url.password && match && Number(match[2]) === issue.number ? match[1]! : null;
  } catch { return null; }
}
export function parseSubIssues(values: unknown[]): SubIssue[] {
  const result = new Map<number, SubIssue>();
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const issue = value as Issue;
    if (issue.pull_request || !Number.isSafeInteger(issue.id) || issue.id < 1 || !Number.isSafeInteger(issue.number) || issue.number < 1 ||
      typeof issue.title !== 'string' || !issue.title.trim() || !['open', 'closed'].includes(issue.state) || !Array.isArray(issue.labels) ||
      issue.labels.some(label => !label || typeof label.name !== 'string')) continue;
    const repository = issueRepository(issue);
    // A child list needs metadata only; do not duplicate potentially large descriptions in this cache.
    if (repository) result.set(issue.id, { repository, issue: {
      id: issue.id, number: issue.number, title: issue.title, state: issue.state, html_url: issue.html_url,
      updated_at: issue.updated_at, created_at: issue.created_at, closed_at: issue.closed_at,
      labels: issue.labels.map(label => ({ name: label.name, color: label.color })), assignees: [],
    } });
  }
  return [...result.values()];
}
/** Per-client bounded, shared lazy cache; no child fan-out. Pending calls share one pagination run. */
export class SubIssuesCache {
  private entries = new Map<string, { at: number; pending: boolean; result: Promise<SubIssue[] | null> }>();
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private fetch: (repository: string, number: number) => Promise<SubIssue[] | null>) {}
  clear(repositories?: readonly string[]) {
    for (const key of this.entries.keys()) if (!repositories || repositories.includes(JSON.parse(key)[0])) this.entries.delete(key);
  }
  get(repository: string, issue: Issue) {
    const key = JSON.stringify([repository, issue.id, issue.updated_at, issue.sub_issues_summary]);
    const previous = this.entries.get(key);
    if (previous && (previous.pending || Date.now() - previous.at < RELATIONS_TTL_MS)) return previous.result;
    const entry = { at: Date.now(), pending: true, result: Promise.resolve<SubIssue[] | null>(null) };
    entry.result = this.run(repository, issue.number).catch(() => null).finally(() => { entry.pending = false; entry.at = Date.now(); });
    this.entries.set(key, entry);
    if (this.entries.size > 300) this.entries.delete(this.entries.keys().next().value!);
    return entry.result;
  }
  private async run(repository: string, number: number) {
    if (this.active >= 3) await new Promise<void>(resolve => this.waiting.push(resolve)); else this.active++;
    try { return await this.fetch(repository, number); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
}
