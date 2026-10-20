import type { StatisticsLoadStatus } from './statistics-load-status';
import type { StatisticsData } from './statistics';
import { STATISTICS_PREVIEW_INTERVAL_MS } from './statistics-client';

/** One UI update across all repositories, even when their collectors finish pages at different times. */
export class StatisticsPreviewBatch {
  private queued = new Map<string, StatisticsData>();
  private statuses = new Map<string, StatisticsLoadStatus>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly publish: (snapshots: Record<string, StatisticsData>, statuses: Record<string, StatisticsLoadStatus>) => void) {}
  add(repository: string, data: StatisticsData, status?: StatisticsLoadStatus) {
    this.queued.set(repository, data);
    if (status) this.statuses.set(repository, status); else this.statuses.delete(repository);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const snapshots = Object.fromEntries(this.queued);
      const statuses = Object.fromEntries(this.statuses);
      this.queued.clear(); this.statuses.clear();
      if (Object.keys(snapshots).length) this.publish(snapshots, statuses);
    }, STATISTICS_PREVIEW_INTERVAL_MS);
  }
  /** A completed repository must never be overwritten by its queued preview. */
  discard(repository: string) { this.queued.delete(repository); this.statuses.delete(repository); }
  clear() { clearTimeout(this.timer); this.timer = undefined; this.queued.clear(); this.statuses.clear(); }
}
