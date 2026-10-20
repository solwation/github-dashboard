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
export const STATISTICS_PREVIEW_INTERVAL_MS = 500;
type StatisticsPreview = (data: StatisticsData) => void;
type SourceReader = () => StatisticsData[StatisticsSourceName];
interface PendingStatistics {
  promise: Promise<StatisticsData>;
  listeners: Set<StatisticsPreview>;
  latest?: StatisticsData;
  schedule?(): void;
  timer?: ReturnType<typeof setTimeout>;
}
const cacheDuration = 5 * 60 * 1000;

/** Every request passes through a shared gate, including concurrent repository loads. */
export class StatisticsCollector {
  private readonly cache = new Map<string, StatisticsData>();
  private readonly restored = new Set<string>();
  private readonly pending = new Map<string, PendingStatistics>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private disposed = false;
  constructor(private readonly client: StatisticsClient) {}
  dispose() {
    this.disposed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.listeners.clear(); }
    this.cache.clear(); this.restored.clear();
  }
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
  private async pages<T>(path: string, limit: number, now: number, stop?: (page: T[]) => boolean, progress?: (source: StatisticsSource<T>) => void): Promise<StatisticsSource<T>> {
    const data: T[] = [];
    let next: string | null = path;
    for (let page = 0; next && page < limit; page++) {
      const response: { data: T[]; next: string | null } = await this.request<T[]>(next);
      if (!Array.isArray(response.data)) throw new Error("Invalid statistics response");
      data.push(...response.data);
      next = stop?.(response.data) ? null : response.next;
      progress?.({ data, complete: !next, fetchedAt: now });
    }
    return { data, complete: !next, fetchedAt: now };
  }
  async load(repository: string, now = Date.now(), force = false, onProgress?: StatisticsPreview): Promise<StatisticsData> {
    if (!validStatisticsRepository(repository)) throw new Error("Invalid repository");
    const window = statisticsCollectionWindow(now), key = `${repository}:${window.from}`;
    if (this.disposed) throw new Error("Statistics session ended");
    const existing = this.cache.get(key) || [...this.cache.values()].filter(data => data.repository === repository && data.fetchedAt <= now && now - data.fetchedAt < STATISTICS_RETENTION_MS).sort((a, b) => b.fetchedAt - a.fetchedAt)[0];
    const pending = this.pending.get(key);
    if (pending) {
      if (onProgress) { pending.listeners.add(onProgress); if (pending.latest) onProgress(pending.latest); else pending.schedule?.(); }
      return pending.promise;
    }
    if (!force && existing && existing.from === window.from && existing.fetchedAt <= now && !this.restored.has(key) && now - existing.fetchedAt < cacheDuration) return existing;
    const state: PendingStatistics = { promise: undefined!, listeners: new Set(onProgress ? [onProgress] : []) };
    const readers = new Map<StatisticsSourceName, SourceReader>();
    const base: StatisticsData = existing ? previewStatistics(existing, now) : {
      repository, ...window, fetchedAt: now, issues: null, events: null, commits: null, changes: null, pulls: null, temporary: [],
    };
    // Build snapshots only on the timer, not once per page or diff. Producers may
    // reference mutable collection arrays; published arrays are detached copies.
    const update = (name: StatisticsSourceName, read: SourceReader) => {
      if (this.disposed) return;
      readers.set(name, read);
      if (!state.listeners.size || state.timer) return;
      state.timer = setTimeout(() => {
        state.timer = undefined;
        if (this.disposed) return;
        const snapshot: StatisticsData = { ...base, fetchedAt: now, temporary: [...base.temporary] };
        for (const [sourceName, get] of readers) {
          const source = get();
          let data = source?.data;
          if (source && !source.complete && base[sourceName]) {
            const identity = (item: unknown) => { const record = item as { id?: number; sha?: string }; return record.sha ?? record.id; };
            // Prefer newly fetched records, then fill from prior data in its
            // existing order. Keeping the tail of a newest-first list would
            // discard the newest known history when the union exceeds its cap.
            const merged = new Map(source.data.map(item => [identity(item), item]));
            for (const item of base[sourceName]!.data) if (!merged.has(identity(item))) merged.set(identity(item), item);
            data = [...merged.values()] as typeof data;
          }
          const limit = { issues: 300, events: 10_000, commits: 600, changes: 600, pulls: 300 }[sourceName];
          Object.assign(snapshot, { [sourceName]: source ? { ...source, data: data!.slice(0, limit) } : null });
        }
        state.latest = snapshot;
        for (const listener of state.listeners) listener(snapshot);
      }, STATISTICS_PREVIEW_INTERVAL_MS);
    };
    state.schedule = () => { const entry = readers.entries().next().value; if (entry) update(...entry); };
    this.pending.set(key, state);
    const work = this.collect(repository, now, existing, force, update).then(result => {
      if (!this.disposed) {
        for (const [oldKey, data] of this.cache) if (data.repository === repository) { this.cache.delete(oldKey); this.restored.delete(oldKey); }
        this.cache.set(key, result);
        if (this.cache.size > 10) this.cache.delete(this.cache.keys().next().value!);
      }
      return result;
    }).finally(() => { clearTimeout(state.timer); state.listeners.clear(); this.pending.delete(key); });
    state.promise = work;
    return work;
  }
  private async collect(repository: string, now: number, previous?: StatisticsData, force = false, progress: (name: StatisticsSourceName, read: SourceReader) => void = () => {}): Promise<StatisticsData> {
    const window = statisticsCollectionWindow(now), root = `/repos/${repository}`;
    const since = `${window.from}T00:00:00Z`, until = new Date(now).toISOString();
    const temporary: StatisticsSourceName[] = [];
    function unique<T extends { id: number }>(source: StatisticsSource<T>) {
      return { ...source, data: [...new Map(source.data.map(item => [item.id, item])).values()] };
    }
    const update = <T>(name: StatisticsSourceName, source: StatisticsSource<T> | null) => {
      progress(name, () => source as StatisticsData[StatisticsSourceName]);
      if (name === "commits" && source === null) progress("changes", () => null);
    };
    const attempt = async <T>(name: StatisticsSourceName, task: () => Promise<StatisticsSource<T>>): Promise<StatisticsSource<T> | null> => {
      let result: StatisticsSource<T> | null;
      try { result = await task(); }
      catch (error) {
        result = null;
        if (!this.denied(error)) {
          temporary.push(name);
          const old = previous?.[name] as StatisticsSource<T> | null | undefined;
          if (old && old.fetchedAt <= now && now - old.fetchedAt < STATISTICS_RETENTION_MS) {
            const covers = previous!.from <= window.from && previous!.to >= window.to;
            result = covers ? old : { ...old, complete: false };
          }
        }
      }
      update(name, result);
      return result;
    };
    const cleanIssues = (raw: StatisticsSource<StatisticsIssue>) => {
      const source = unique(raw);
      return { ...source, data: source.data.filter(issue => !issue.pull_request) };
    };
    const cleanEvents = (raw: StatisticsSource<StatisticsEvent>) => {
      const source = unique(raw);
      return { ...source, data: source.data.filter(event => event.issue && !event.issue.pull_request
        && ["closed", "reopened", "labeled", "unlabeled"].includes(event.event) && event.created_at >= since && event.created_at <= until) };
    };
    const [issues, events, commits, pulls] = await Promise.all([
      attempt("issues", async () => {
        // Reuse the board's fresh lists when they cover the whole window; a forced refresh always asks GitHub.
        const board = force ? null : this.client.boardIssues?.(repository, since, cacheDuration, now);
        if (board) return { data: board, complete: true, fetchedAt: now };
        return cleanIssues(await this.pages<StatisticsIssue>(`${root}/issues?state=all&sort=updated&direction=desc&since=${since}&per_page=100`, statisticsLimits.issues, now, undefined, source => progress("issues", () => cleanIssues(source))));
      }),
      attempt("events", async () => {
        const source = await this.pages<StatisticsEvent>(`${root}/issues/events?per_page=100`, statisticsLimits.events, now, undefined, source => progress("events", () => cleanEvents(source)));
        // Repository event pages also contain labels, assignments and other activity. Five
        // pages can cover less than a day on an active repository (#212). Follow next
        // links to exhaustion (with a safety ceiling), without assuming date ordering:
        // the API does not document a sort guarantee. Keep only events used by the
        // statistics and board history so unrelated activity does not fill the vault.
        return cleanEvents(source);
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
          const historical = reuse ? old!.data.filter(commit => commitDate(commit) >= since && commitDate(commit) < from) : [];
          const cleanCommits = (source: StatisticsSource<StatisticsCommit>) => {
            const data = [...new Map([...historical, ...source.data].map(commit => [commit.sha, commit])).values()]
              .filter(commit => commitDate(commit) >= since && commitDate(commit) <= until)
              .sort((a, b) => Date.parse(commitDate(b)) - Date.parse(commitDate(a)));
            return { ...source, complete: source.complete && data.length <= 600, data: data.slice(0, 600), historyVerifiedAt: reuse ? verified : now };
          };
          const source = await this.pages<StatisticsCommit>(`${root}/commits?since=${from}&per_page=100`, statisticsLimits.commits, now, undefined, source => progress("commits", () => cleanCommits(source)));
          return cleanCommits(source);
        } catch (error) {
          // GitHub returns 409 for an empty Git repository: this is a real zero.
          if ((error as { status?: number; emptyRepository?: boolean })?.status === 409 && (error as { emptyRepository?: boolean }).emptyRepository === true) return { data: [], complete: true, fetchedAt: now, historyVerifiedAt: now };
          throw error;
        }
      }),
      attempt("pulls", async () => unique(await this.pages<StatisticsPull>(`${root}/pulls?state=all&sort=updated&direction=desc&per_page=100`, statisticsLimits.pulls, now,
        page => page.length > 0 && page[page.length - 1]!.updated_at < since, source => progress("pulls", () => unique(source))))),
    ]);
    const changes = commits ? await attempt<StatisticsChange>("changes", async () => {
      const nonMerge = commits.data.filter(commit => commit.parents.length <= 1);
      const records: StatisticsChange[] = [];
      const old = new Map(previous?.changes?.data.map(change => [change.sha, change]) || []);
      // Every collected commit needs its diff, including reused historical commits;
      // taking only the newest 60 silently lost older days within a selected period.
      const queue = nonMerge.slice(0, statisticsLimits.changes);
      // Three workers, never one promise per item or repository-sized fan-out.
      const previewChanges = () => progress("changes", () => ({ data: records, complete: false, fetchedAt: now }));
      let stopped = false;
      const results = await Promise.allSettled(Array.from({ length: Math.min(statisticsLimits.concurrency, queue.length) }, async () => {
        while (queue.length && !stopped) {
          try {
          const commit = queue.shift()!;
          if (old.has(commit.sha)) { records.push(old.get(commit.sha)!); previewChanges(); continue; }
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
          previewChanges();
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
