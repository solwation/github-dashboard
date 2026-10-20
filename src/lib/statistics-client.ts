import { previewStatistics, validStatisticsRepository, STATISTICS_RETENTION_MS } from "./statistics-cache";
import {
  commitContributor, commitDate, statisticsCollectionWindow,
  type StatisticsChange, type StatisticsCommit, type StatisticsData, type StatisticsEvent,
  type StatisticsIssue, type StatisticsPull, type StatisticsSource, type StatisticsSourceName,
} from "./statistics";

export interface StatisticsClient {
  /** `store: false` marks one-shot URLs that must not occupy the shared ETag cache (#108). */
  request<T>(path: string, options?: { store?: boolean }): Promise<{ data: T; next: string | null }>;
  retryAfterMs?(): number;
  /**
   * Issues updated since `since`, rebuilt from the board's recently confirmed list responses without
   * a request (#136), or null when the board does not fully and freshly cover the window.
   */
  boardIssues?(repository: string, since: string, maxAgeMs?: number, now?: number): StatisticsIssue[] | null;
}
export const statisticsLimits = { issues: 3, events: 100, commits: 3, pulls: 3, changes: 600, files: 3, concurrency: 3 } as const;
const cacheDuration = 5 * 60 * 1000;

/** Every request passes through a shared gate, including concurrent repository loads. */
export class StatisticsCollector {
  private readonly cache = new Map<string, StatisticsData>();
  private readonly restored = new Set<string>();
  private readonly pending = new Map<string, Promise<StatisticsData>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private disposed = false;
  constructor(private readonly client: StatisticsClient) {}
  dispose() { this.disposed = true; this.cache.clear(); this.restored.clear(); }
  restore(entries: StatisticsData[]) {
    if (this.disposed) return;
    for (const data of entries) {
      const key = `${data.repository}:${data.from}`;
      this.cache.set(key, data); this.restored.add(key);
    }
  }
  export() { return [...this.cache.values()]; }
  cached(repository: string, now = Date.now()) {
    const data = [...this.cache.values()].filter(data => data.repository === repository && data.fetchedAt <= now && now - data.fetchedAt < STATISTICS_RETENTION_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    return data ? previewStatistics(data, now) : undefined;
  }
  private async request<T>(path: string, options?: { store?: boolean }) {
    if (this.active >= statisticsLimits.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try {
      if (this.disposed) throw new Error("Statistics session ended");
      if (this.client.retryAfterMs?.()) throw new Error("Statistics temporarily rate limited");
      return await (options ? this.client.request<T>(path, options) : this.client.request<T>(path));
    } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
  private denied(error: unknown) {
    const response = error as { status?: number; permissionDenied?: boolean; rateLimited?: boolean };
    return (response?.permissionDenied === true || response?.status === 404) && !response.rateLimited && !(this.client.retryAfterMs?.() || 0);
  }
  private async pages<T>(path: string, limit: number, now: number, stop?: (page: T[]) => boolean): Promise<StatisticsSource<T>> {
    const data: T[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < limit; page++) {
      const response: { data: T[]; next: string | null } = await this.request<T[]>(next);
      if (!Array.isArray(response.data)) throw new Error("Invalid statistics response");
      data.push(...response.data);
      next = stop?.(response.data) ? null : response.next;
    }
    return { data, complete: !next, fetchedAt: now };
  }
  async load(repository: string, now = Date.now(), force = false): Promise<StatisticsData> {
    if (!validStatisticsRepository(repository)) throw new Error("Invalid repository");
    const window = statisticsCollectionWindow(now), key = `${repository}:${window.from}`;
    if (this.disposed) throw new Error("Statistics session ended");
    const existing = this.cache.get(key) || [...this.cache.values()].filter(data => data.repository === repository && data.fetchedAt <= now && now - data.fetchedAt < STATISTICS_RETENTION_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    if (!force && existing && existing.from === window.from && existing.fetchedAt <= now && !this.restored.has(key) && now - existing.fetchedAt < cacheDuration) return existing;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.collect(repository, now, existing, force).then(result => {
      if (!this.disposed) {
        for (const [oldKey, data] of this.cache) if (data.repository === repository) { this.cache.delete(oldKey); this.restored.delete(oldKey); }
        this.cache.set(key, result);
        if (this.cache.size > 10) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  private async collect(repository: string, now: number, previous?: StatisticsData, force = false): Promise<StatisticsData> {
    const window = statisticsCollectionWindow(now), root = `/repos/${repository}`;
    const since = `${window.from}T00:00:00Z`, until = new Date(now).toISOString();
    const temporary: StatisticsSourceName[] = [];
    async function unique<T extends { id: number }>(source: StatisticsSource<T>) {
      return { ...source, data: [...new Map(source.data.map(item => [item.id, item])).values()] };
    }
    const attempt = async <T>(name: StatisticsSourceName, task: () => Promise<StatisticsSource<T>>): Promise<StatisticsSource<T> | null> => {
      try { return await task(); }
      catch (error) {
        if (this.denied(error)) return null;
        temporary.push(name);
        const old = previous?.[name] as StatisticsSource<T> | null | undefined;
        if (!old || old.fetchedAt > now || now - old.fetchedAt >= STATISTICS_RETENTION_MS) return null;
        const covers = previous!.from <= window.from && previous!.to >= window.to;
        return covers ? old : { ...old, complete: false };
      }
    };
    const [issues, events, commits, pulls] = await Promise.all([
      attempt("issues", async () => {
        // Reuse the board's fresh lists when they cover the whole window; a forced refresh always asks GitHub.
        const board = force ? null : this.client.boardIssues?.(repository, since, cacheDuration, now);
        if (board) return { data: board, complete: true, fetchedAt: now };
        const source = await unique(await this.pages<StatisticsIssue>(`${root}/issues?state=all&sort=updated&direction=desc&since=${since}&per_page=100`, statisticsLimits.issues, now));
        return { ...source, data: source.data.filter(issue => !issue.pull_request) };
      }),
      attempt("events", async () => {
        const source = await unique(await this.pages<StatisticsEvent>(`${root}/issues/events?per_page=100`, statisticsLimits.events, now));
        // Repository event pages also contain labels, assignments and other activity. Five
        // pages can cover less than a day on an active repository (#212). Follow next
        // links to exhaustion (with a safety ceiling), without assuming date ordering:
        // the API does not document a sort guarantee. Keep only events used by the
        // statistics and board history so unrelated activity does not fill the vault.
        return { ...source, data: source.data.filter(event => event.issue && !event.issue.pull_request
          && ["closed", "reopened", "labeled", "unlabeled"].includes(event.event)
          && event.created_at >= since && event.created_at <= until) };
      }),
      attempt("commits", async () => {
        try {
          const old = previous?.commits;
          const verified = old?.historyVerifiedAt ?? old?.fetchedAt ?? 0;
          const reuse = !force && !!old?.complete && previous!.from <= window.from && previous!.to <= window.to && previous!.to > window.from &&
            verified <= now && now - verified < STATISTICS_RETENTION_MS;
          // The previous final day was partial; always refetch it along with new days.
          const from = reuse ? `${previous!.to}T00:00:00Z` : since;
          // A day-stable URL (no `until`; filtered below) lets unchanged history revalidate as a free 304 (#136).
          const source = await this.pages<StatisticsCommit>(`${root}/commits?since=${from}&per_page=100`, statisticsLimits.commits, now);
          const historical = reuse ? old!.data.filter(commit => commitDate(commit) >= since && commitDate(commit) < from) : [];
          const data = [...new Map([...historical, ...source.data].map(commit => [commit.sha, commit])).values()]
            .filter(commit => commitDate(commit) >= since && commitDate(commit) <= until)
            .sort((a, b) => Date.parse(commitDate(b)) - Date.parse(commitDate(a)));
          return { ...source, complete: source.complete && data.length <= 600, data: data.slice(0, 600), historyVerifiedAt: reuse ? verified : now };
        } catch (error) {
          // GitHub returns 409 for an empty Git repository: this is a real zero.
          if ((error as { status?: number; emptyRepository?: boolean })?.status === 409 && (error as { emptyRepository?: boolean }).emptyRepository === true) return { data: [], complete: true, fetchedAt: now, historyVerifiedAt: now };
          throw error;
        }
      }),
      attempt("pulls", async () => unique(await this.pages<StatisticsPull>(`${root}/pulls?state=all&sort=updated&direction=desc&per_page=100`, statisticsLimits.pulls, now,
        page => page.length > 0 && page[page.length - 1]!.updated_at < since))),
    ]);
    const changes = commits ? await attempt<StatisticsChange>("changes", async () => {
      const nonMerge = commits.data.filter(commit => commit.parents.length <= 1);
      const records: StatisticsChange[] = [];
      const old = new Map(previous?.changes?.data.map(change => [change.sha, change]) || []);
      // Every collected commit needs its diff, including reused historical commits;
      // taking only the newest 60 silently lost older days within a selected period.
      const queue = nonMerge.slice(0, statisticsLimits.changes);
      // Three workers, never one promise per item or repository-sized fan-out.
      let stopped = false;
      const results = await Promise.allSettled(Array.from({ length: Math.min(statisticsLimits.concurrency, queue.length) }, async () => {
        while (queue.length && !stopped) {
          try {
          const commit = queue.shift()!;
          if (old.has(commit.sha)) { records.push(old.get(commit.sha)!); continue; }
          let next: string | null = `${root}/commits/${encodeURIComponent(commit.sha)}?per_page=100`;
          let additions: number | undefined, deletions: number | undefined;
          const files = new Set<string>();
          for (let page = 0; next && page < statisticsLimits.files; page++) {
            // Commit details are immutable and kept in `changes`: never let them evict reusable ETags (#108).
            const response: { data: { stats?: { additions: number; deletions: number }; files?: { filename: string }[] }; next: string | null } = await this.request(next, { store: false });
            additions ??= response.data.stats?.additions;
            deletions ??= response.data.stats?.deletions;
            for (const file of response.data.files || []) files.add(file.filename);
            if (!Array.isArray(response.data.files)) throw new Error("Missing commit files");
            next = response.next;
          }
          if (!Number.isFinite(additions) || !Number.isFinite(deletions)) throw new Error("Missing commit statistics");
          records.push({ sha: commit.sha, date: commitDate(commit), contributor: commitContributor(commit), additions: additions!, deletions: deletions!, files: files.size, filesComplete: !next });
          } catch (error) { stopped = true; throw error; }
        }
      }));
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      return { data: records, complete: commits.complete && nonMerge.length <= statisticsLimits.changes, fetchedAt: now };
    }) : null;
    return { repository, ...window, fetchedAt: now, issues, events, commits, changes, pulls, temporary };
  }
}
