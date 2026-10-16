import {
  commitContributor, commitDate, statisticsWindow,
  type StatisticsChange, type StatisticsCommit, type StatisticsData, type StatisticsEvent,
  type StatisticsIssue, type StatisticsPull, type StatisticsSource, type StatisticsSourceName,
} from "./statistics";

export interface StatisticsClient {
  request<T>(path: string): Promise<{ data: T; next: string | null }>;
  retryAfterMs?(): number;
}
export const statisticsLimits = { issues: 3, events: 5, commits: 3, pulls: 3, changes: 60, files: 3, concurrency: 3, repositories: 5 } as const;
const cacheDuration = 5 * 60 * 1000;

/** Every request passes through a shared gate, including concurrent repository loads. */
export class StatisticsCollector {
  private readonly cache = new Map<string, StatisticsData>();
  private readonly pending = new Map<string, Promise<StatisticsData>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private disposed = false;
  constructor(private readonly client: StatisticsClient) {}
  dispose() { this.disposed = true; this.cache.clear(); }
  private async request<T>(path: string) {
    if (this.active >= statisticsLimits.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try {
      if (this.disposed) throw new Error("Statistics session ended");
      if (this.client.retryAfterMs?.()) throw new Error("Statistics temporarily rate limited");
      return await this.client.request<T>(path);
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
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
    const window = statisticsWindow(now), key = `${repository}:${window.from}`;
    const existing = this.cache.get(key);
    if (!force && existing && now - existing.fetchedAt < cacheDuration) return existing;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const work = this.collect(repository, now, existing).then(result => {
      if (!this.disposed) {
        this.cache.set(key, result);
        if (this.cache.size > 10) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  private async collect(repository: string, now: number, previous?: StatisticsData): Promise<StatisticsData> {
    const window = statisticsWindow(now), root = `/repos/${repository}`;
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
        return (previous?.[name] as StatisticsSource<T> | null | undefined) || null;
      }
    };
    const [issues, events, commits, pulls] = await Promise.all([
      attempt("issues", async () => {
        const source = await unique(await this.pages<StatisticsIssue>(`${root}/issues?state=all&sort=updated&direction=desc&since=${since}&per_page=100`, statisticsLimits.issues, now));
        return { ...source, data: source.data.filter(issue => !issue.pull_request) };
      }),
      attempt("events", async () => {
        const source = await unique(await this.pages<StatisticsEvent>(`${root}/issues/events?per_page=100`, statisticsLimits.events, now));
        return { ...source, data: source.data.filter(event => event.issue && !event.issue.pull_request && event.created_at >= since && event.created_at <= until) };
      }),
      attempt("commits", async () => {
        try {
          const source = await this.pages<StatisticsCommit>(`${root}/commits?since=${since}&until=${until}&per_page=100`, statisticsLimits.commits, now);
          return { ...source, data: [...new Map(source.data.map(commit => [commit.sha, commit])).values()] };
        } catch (error) {
          // GitHub returns 409 for an empty Git repository: this is a real zero.
          if ((error as { status?: number; emptyRepository?: boolean })?.status === 409 && (error as { emptyRepository?: boolean }).emptyRepository === true) return { data: [], complete: true, fetchedAt: now };
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
            const response: { data: { stats?: { additions: number; deletions: number }; files?: { filename: string }[] }; next: string | null } = await this.request(next);
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
