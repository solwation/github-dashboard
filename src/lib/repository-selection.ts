import type { Lane, Repo } from "./model";

/** Publish selection changes before fetching, preserving retained lane objects. */
export function selectedLanes(lanes: Lane[], repositories: Repo[], selected: string[]): Lane[] {
  const existing = new Map(lanes.map(lane => [lane.repo.full_name, lane]));
  const available = new Map(repositories.map(repo => [repo.full_name, repo]));
  return [...new Set(selected)].flatMap(name => {
    const repo = available.get(name);
    if (!repo) return [];
    return [existing.get(name) || { repo, issues: [], labels: [], loading: true }];
  });
}

export class RepositoryRequestCancelled extends Error {}

/** Share pending reads across selection changes; cap all repository reads at three. */
export class RepositoryRequestQueue {
  private pending = new Map<string, Promise<unknown>>();
  private waiting: (() => void)[] = [];
  private active = 0;
  private epoch = 0;
  constructor(private readonly concurrency = 3) {}
  clear() { this.epoch++; this.pending.clear(); }
  run<T>(key: string, request: () => Promise<T>): Promise<T> {
    const pending = this.pending.get(key);
    if (pending) return pending as Promise<T>;
    const epoch = this.epoch;
    const work = this.execute(async () => {
      if (epoch !== this.epoch) throw new RepositoryRequestCancelled();
      return request();
    }).finally(() => { if (this.pending.get(key) === work) this.pending.delete(key); });
    this.pending.set(key, work);
    return work;
  }
  private async execute<T>(request: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await request(); }
    finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }
}
