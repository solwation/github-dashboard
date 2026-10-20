import type { StatisticsSourceName } from './statistics';

/** Ephemeral collection feedback; never part of StatisticsData or the encrypted cache. */
export interface StatisticsLoadStatus {
  phase: 'lists' | 'changes';
  collectionFrom: string;
  collectionTo: string;
  sourcesDone: number;
  sourcesTotal: 4;
  completeSources: number;
  oldestActivityAt?: number;
  reachedDays?: number;
  diffsDone?: number;
  diffsTotal?: number;
  percent?: number;
  remainingMs?: number;
}

export class StatisticsLoadTracker {
  private sources = new Map<StatisticsSourceName, boolean>();
  private oldest?: number;
  private changes?: { total: number; done: number; freshTotal: number; freshDone: number; startedAt: number };
  private readonly from: number;
  constructor(private readonly window: { from: string; to: string }, private readonly until: number, private readonly clock = () => Date.now()) {
    this.from = Date.parse(`${window.from}T00:00:00Z`);
  }
  sourceDone(source: StatisticsSourceName, complete: boolean) {
    if (source !== 'changes') this.sources.set(source, complete);
  }
  /** An old record is evidence of reached activity, never evidence of continuous coverage. */
  observe(date: string | null | undefined) {
    if (!date) return;
    const time = Date.parse(date);
    if (Number.isFinite(time) && time >= this.from && time <= this.until) this.oldest = Math.min(this.oldest ?? time, time);
  }
  startChanges(total: number, reused: number) {
    this.changes = { total, done: 0, freshTotal: Math.max(0, total - reused), freshDone: 0, startedAt: this.clock() };
  }
  diffDone(fresh: boolean) {
    if (!this.changes) return;
    this.changes.done++;
    if (fresh) this.changes.freshDone++;
  }
  snapshot(): StatisticsLoadStatus {
    const status: StatisticsLoadStatus = {
      phase: this.changes ? 'changes' : 'lists', collectionFrom: `${this.window.from}T00:00:00Z`, collectionTo: new Date(this.until).toISOString(),
      sourcesDone: this.sources.size, sourcesTotal: 4, completeSources: [...this.sources.values()].filter(Boolean).length,
    };
    if (this.oldest !== undefined) {
      status.oldestActivityAt = this.oldest;
      status.reachedDays = Math.floor((this.until - this.oldest) / 86_400_000);
    }
    if (this.changes) {
      const { total, done, freshTotal, freshDone, startedAt } = this.changes;
      status.diffsDone = done; status.diffsTotal = total;
      status.percent = total ? Math.floor(done / total * 100) : 100;
      const elapsed = this.clock() - startedAt, remaining = freshTotal - freshDone;
      // Cached SHA records provide no network throughput sample. The estimate
      // applies only to the discovered diff work, not unknown or capped history.
      if (freshDone >= 3 && elapsed >= 2000 && remaining > 0) status.remainingMs = Math.ceil(remaining * elapsed / freshDone);
    }
    return status;
  }
}
