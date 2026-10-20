import type { StatisticsData } from './statistics';
import { STATISTICS_PREVIEW_INTERVAL_MS } from './statistics-client';

/** One UI update across all repositories, even when their collectors finish pages at different times. */
export class StatisticsPreviewBatch {
  private queued = new Map<string, StatisticsData>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly publish: (snapshots: Record<string, StatisticsData>) => void) {}
  add(repository: string, data: StatisticsData) {
    this.queued.set(repository, data);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const snapshots = Object.fromEntries(this.queued);
      this.queued.clear();
      if (Object.keys(snapshots).length) this.publish(snapshots);
    }, STATISTICS_PREVIEW_INTERVAL_MS);
  }
  /** A completed repository must never be overwritten by its queued preview. */
  discard(repository: string) { this.queued.delete(repository); }
  clear() { clearTimeout(this.timer); this.timer = undefined; this.queued.clear(); }
}
