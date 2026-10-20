import { loadStatistics, saveStatistics } from './vault';
import { statisticsCollectionWindow, statisticsWindow, type StatisticsData, type StatisticsSourceName } from './statistics';
export const STATISTICS_RETENTION_MS = 7 * 86400000;
export const STATISTICS_CACHE_BYTES = 8 * 1024 * 1024;
export const STATISTICS_CACHE_REPOSITORIES = 10;
export const statisticsSourceNames: StatisticsSourceName[] = ['issues', 'events', 'commits', 'changes', 'pulls'];
export function validStatisticsRepository(value: unknown): value is string { return typeof value === "string" && /^[\w.-]+\/[\w.-]+$/.test(value) && value.split("/").every(part => part !== "." && part !== ".."); }
interface StatisticsCache { version: 1; repositories: StatisticsData[] }
function date(value: unknown) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function labels(value: unknown): boolean { return Array.isArray(value) && value.every(label => label && typeof label.name === 'string'); }
/** Validate authenticated bytes too: damaged or obsolete schemas must not break charts. */
export function parseStatisticsCache(value: unknown, now = Date.now()): StatisticsData[] {
  const saved = value as Partial<StatisticsCache> | null;
  if (saved?.version !== 1 || !Array.isArray(saved.repositories)) return [];
  const parsed = new Map<string, StatisticsData>();
  for (const entry of saved.repositories.slice(-STATISTICS_CACHE_REPOSITORIES)) {
    if (!entry || !validStatisticsRepository(entry.repository) || !date(entry.from) || !date(entry.to) || entry.from > entry.to || !finite(entry.fetchedAt) || entry.fetchedAt > now || now - entry.fetchedAt >= STATISTICS_RETENTION_MS) continue;
    const expected = statisticsCollectionWindow(entry.fetchedAt);
    const legacy = statisticsWindow(entry.fetchedAt);
    const legacyCoverage = entry.from === legacy.from && entry.to === legacy.to;
    if ((entry.from !== expected.from || entry.to !== expected.to) && !legacyCoverage) continue;
    const copy: StatisticsData = { ...entry, temporary: Array.isArray(entry.temporary) ? entry.temporary.filter(name => statisticsSourceNames.includes(name)) : [] };
    for (const name of statisticsSourceNames) {
      const source = entry[name];
      if (!source || !Array.isArray(source.data) || typeof source.complete !== 'boolean' || !finite(source.fetchedAt) || source.fetchedAt > now || now - source.fetchedAt >= STATISTICS_RETENTION_MS) { copy[name] = null; continue; }
      const limit = { issues: 300, events: 10_000, commits: 600, changes: 600, pulls: 300 }[name];
      let valid = source.data.length <= limit;
      for (const raw of source.data) {
        if (!raw || typeof raw !== 'object') { valid = false; break; }
        const item = raw as unknown as Record<string, unknown>;
        if (name === 'issues') valid &&= finite(item.id) && finite(item.number) && typeof item.created_at === 'string' && typeof item.updated_at === 'string' && labels(item.labels);
        else if (name === 'events') {
          const issue = item.issue as Record<string, unknown> | undefined;
          valid &&= finite(item.id) && typeof item.created_at === 'string' && typeof item.event === 'string' && !!issue && typeof issue.created_at === 'string' && labels(issue.labels);
        } else if (name === 'commits') {
          const commit = item.commit as Record<string, unknown> | undefined;
          valid &&= typeof item.sha === 'string' && Array.isArray(item.parents) && !!commit && (typeof (commit.committer as { date?: unknown } | undefined)?.date === 'string' || typeof (commit.author as { date?: unknown } | undefined)?.date === 'string');
        } else if (name === 'changes') valid &&= typeof item.sha === 'string' && typeof item.date === 'string' && typeof item.contributor === 'string' && finite(item.additions) && finite(item.deletions) && finite(item.files) && typeof item.filesComplete === 'boolean';
        else valid &&= finite(item.id) && typeof item.created_at === 'string' && typeof item.updated_at === 'string' && labels(item.labels);
      }
      // Missing historical metadata forces a full listing rather than trusting legacy coverage.
      const history = finite(source.historyVerifiedAt) && source.historyVerifiedAt > 0 && source.historyVerifiedAt <= source.fetchedAt ? source.historyVerifiedAt : 0;
      (copy[name] as typeof source | null) = valid ? { ...source, complete: source.complete && !legacyCoverage, ...(name === 'commits' ? { historyVerifiedAt: history, complete: source.complete && !legacyCoverage && history > 0 } : {}) } : null;
    }
    if (!copy.commits) copy.changes = null;
    else if (copy.changes) {
      const membership = new Set(copy.commits.data.map(commit => commit.sha));
      const retained = copy.changes.data.filter(change => membership.has(change.sha));
      copy.changes = { ...copy.changes, data: retained, complete: copy.changes.complete && copy.commits.complete && retained.length === copy.changes.data.length };
    }
    parsed.set(copy.repository, copy);
  }
  return [...parsed.values()];
}
export function previewStatistics(data: StatisticsData, now: number): StatisticsData {
  const window = statisticsCollectionWindow(now);
  const covers = data.from <= window.from && data.to >= window.to;
  return { ...data, ...window, ...Object.fromEntries(statisticsSourceNames.map(name => [name, data[name] ? { ...data[name], complete: covers && data[name]!.complete } : null])) };
}
export async function readStatisticsCache(token: string, now = Date.now()) {
  try { return parseStatisticsCache(await loadStatistics(token), now); } catch { return []; }
}
function compactStatistics(entry: StatisticsData): StatisticsData {
  const person = (value?: { login: string } | null) => value ? { login: value.login } : null;
  const issue = (value: import('./statistics').StatisticsIssue) => ({ id: value.id, number: value.number, created_at: value.created_at, updated_at: value.updated_at, labels: value.labels.map(label => ({ name: label.name })), user: person(value.user), ...(value.pull_request ? { pull_request: true } : {}) });
  const source = <T, U>(value: import('./statistics').StatisticsSource<T> | null, map: (item: T) => U) => value ? { data: value.data.map(map), complete: value.complete, fetchedAt: value.fetchedAt, ...(value.historyVerifiedAt === undefined ? {} : { historyVerifiedAt: value.historyVerifiedAt }) } : null;
  return {
    repository: entry.repository, from: entry.from, to: entry.to, fetchedAt: entry.fetchedAt, temporary: entry.temporary,
    issues: source(entry.issues, issue),
    events: source(entry.events, event => ({ id: event.id, event: event.event, created_at: event.created_at, actor: person(event.actor), ...(event.issue ? { issue: issue(event.issue) } : {}), ...(typeof event.label?.name === 'string' ? { label: { name: event.label.name } } : {}) })),
    commits: source(entry.commits, commit => ({ sha: commit.sha, parents: commit.parents.map(parent => ({ sha: parent.sha })), author: person(commit.author), commit: { author: commit.commit.author ? { name: commit.commit.author.name, date: commit.commit.author.date } : undefined, committer: commit.commit.committer ? { date: commit.commit.committer.date } : undefined } })),
    changes: source(entry.changes, change => ({ sha: change.sha, date: change.date, contributor: change.contributor, additions: change.additions, deletions: change.deletions, files: change.files, filesComplete: change.filesComplete })),
    pulls: source(entry.pulls, pull => ({ id: pull.id, created_at: pull.created_at, updated_at: pull.updated_at, closed_at: pull.closed_at, merged_at: pull.merged_at, labels: pull.labels.map(label => ({ name: label.name })), user: person(pull.user) })),
  };
}
export async function writeStatisticsCache(token: string, repositories: StatisticsData[]) {
  const unique = new Map<string, StatisticsData>();
  for (const data of repositories) { unique.delete(data.repository); unique.set(data.repository, compactStatistics(data)); }
  const saved: StatisticsCache = { version: 1, repositories: [] };
  const encoder = new TextEncoder();
  for (const entry of [...unique.values()].reverse()) {
    const next = { ...saved, repositories: [entry, ...saved.repositories] };
    if (encoder.encode(JSON.stringify(next)).byteLength > STATISTICS_CACHE_BYTES) continue;
    saved.repositories = next.repositories;
    if (saved.repositories.length === STATISTICS_CACHE_REPOSITORIES) break;
  }
  if (repositories.length && !saved.repositories.length) throw new Error("Statistics cache capacity exceeded");
  await saveStatistics(token, saved);
}
