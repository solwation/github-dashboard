import type { StatisticsClient } from "./statistics-client";
import type { StatisticsData } from "./statistics";

/**
 * Background statistics collection (#135): fills the encrypted statistics cache in small idle
 * portions so the lazily loaded Statistics view opens from cache. The heavy collector, cache codec
 * and statistics window are imported on demand so the startup bundle does not grow.
 */
export interface RateLimitInfo { remaining: number; limit: number; resetAt: number }
export interface BackgroundStatisticsClient extends StatisticsClient { rateLimit?(): RateLimitInfo | null }
export interface BackgroundCollector { restore(entries: StatisticsData[]): void; load(repository: string, now?: number): Promise<StatisticsData>; dispose(): void }
export interface BackgroundModules {
  createCollector(client: StatisticsClient): BackgroundCollector;
  read(token: string, now?: number): Promise<StatisticsData[]>;
  write(token: string, entries: StatisticsData[]): Promise<void>;
  window(now?: number): { from: string; to: string };
}
export interface BackgroundEnvironment {
  now(): number;
  hidden(): boolean;
  online(): boolean;
  saveData(): boolean;
  reducedData(): boolean;
  /** Synchronous view of a battery reading that may arrive asynchronously. */
  lowBattery(): boolean;
  idle(callback: () => void, timeout: number): () => void;
  delay(callback: () => void, ms: number): () => void;
  /** Subscribes to user interaction and returns an unsubscribe function. */
  onInteraction(callback: () => void): () => void;
}
export interface BackgroundOptions {
  client: BackgroundStatisticsClient;
  token: string;
  /** Selected repositories in board order; only the first cache-sized portion is collected. */
  repositories(): string[];
  /** Board sync, restoration or anything else with foreground priority. */
  busy(): boolean;
  /** False while the Statistics view owns collection or the session cannot collect. */
  allowed(): boolean;
  modules?: () => Promise<BackgroundModules>;
  environment?: BackgroundEnvironment;
  /**
   * Receives cached statistics (once per run) and each newly collected repository, e.g. so the
   * board can derive closed issues' work starts from the events without requests (#141).
   */
  collected?(data: StatisticsData): void;
}
export type PauseReason = "stopped" | "disallowed" | "hidden" | "offline" | "save-data" | "reduced-data" | "battery" | "rate-limit" | "busy" | "interaction";

export const BACKGROUND_REPOSITORIES = 10;
export const BACKGROUND_STALE_MS = 60 * 60 * 1000;
export const BACKGROUND_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
export const BACKGROUND_START_DELAY_MS = 30 * 1000;
export const BACKGROUND_PORTION_GAP_MS = 10 * 1000;
export const BACKGROUND_PAUSE_RETRY_MS = 30 * 1000;
export const BACKGROUND_IDLE_RECHECK_MS = 5 * 60 * 1000;
export const BACKGROUND_IDLE_TIMEOUT_MS = 2000;
export const BACKGROUND_INTERACTION_QUIET_MS = 3000;
/** Keep the larger of an absolute reserve or a quarter of the hourly quota for the board. */
export const BACKGROUND_RATE_RESERVE = 1000;
export const BACKGROUND_RATE_RESERVE_SHARE = 0.25;
export const BACKGROUND_BATTERY_LEVEL = 0.2;

class BackgroundPaused extends Error { constructor(readonly reason: PauseReason) { super(`Background statistics paused: ${reason}`); } }

async function defaultModules(): Promise<BackgroundModules> {
  const [client, cache, statistics] = await Promise.all([import("./statistics-client"), import("./statistics-cache"), import("./statistics")]);
  return {
    createCollector: source => new client.StatisticsCollector(source),
    read: cache.readStatisticsCache, write: cache.writeStatisticsCache, window: statistics.statisticsWindow,
  };
}

type BatteryLike = { level: number; charging: boolean };
export function browserEnvironment(): BackgroundEnvironment {
  let battery: BatteryLike | null = null;
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; getBattery?: () => Promise<BatteryLike> };
  try { void nav.getBattery?.().then(value => { battery = value; }, () => undefined); } catch { /* Unsupported. */ }
  let reduced: MediaQueryList | null = null;
  try { reduced = window.matchMedia?.("(prefers-reduced-data: reduce)") ?? null; } catch { reduced = null; }
  return {
    now: () => Date.now(),
    hidden: () => document.hidden,
    online: () => navigator.onLine,
    saveData: () => nav.connection?.saveData === true,
    reducedData: () => reduced?.matches === true,
    lowBattery: () => !!battery && !battery.charging && battery.level < BACKGROUND_BATTERY_LEVEL,
    idle(callback, timeout) {
      if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(() => callback(), { timeout });
        return () => window.cancelIdleCallback(handle);
      }
      const handle = window.setTimeout(callback, Math.min(timeout, 250));
      return () => window.clearTimeout(handle);
    },
    delay(callback, ms) { const handle = window.setTimeout(callback, ms); return () => window.clearTimeout(handle); },
    onInteraction(callback) {
      const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
      for (const name of events) window.addEventListener(name, callback, { passive: true, capture: true });
      return () => { for (const name of events) window.removeEventListener(name, callback, { capture: true }); };
    },
  };
}

export function rateLimitLow(info: RateLimitInfo | null | undefined) {
  if (!info) return false;
  return info.remaining < Math.max(BACKGROUND_RATE_RESERVE, info.limit * BACKGROUND_RATE_RESERVE_SHARE);
}

/** Missing repositories first, then the stalest; fresh ones and recent failures are skipped. */
export function nextBackgroundRepository(repositories: string[], cached: StatisticsData[], window: { from: string }, now: number, failures: Map<string, number>) {
  const candidates: { name: string; fetchedAt: number }[] = [];
  for (const name of repositories.slice(0, BACKGROUND_REPOSITORIES)) {
    const failed = failures.get(name);
    if (failed !== undefined && now - failed < BACKGROUND_FAILURE_BACKOFF_MS) continue;
    const entry = cached.find(data => data.repository === name);
    const fresh = entry && entry.from === window.from && entry.fetchedAt <= now && now - entry.fetchedAt < BACKGROUND_STALE_MS && !entry.temporary.length;
    if (!fresh) candidates.push({ name, fetchedAt: entry?.fetchedAt ?? -Infinity });
  }
  return candidates.sort((a, b) => a.fetchedAt - b.fetchedAt)[0]?.name ?? null;
}

export class StatisticsBackground {
  private readonly environment: BackgroundEnvironment;
  private readonly modules: () => Promise<BackgroundModules>;
  private cancel: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private running = false;
  private working = false;
  private lastInteraction = -Infinity;
  private readonly failures = new Map<string, number>();
  private deliveredCache = false;
  /** Exposed for tests and diagnostics. */
  lastPause: PauseReason | null = null;
  completed = 0;
  constructor(private readonly options: BackgroundOptions) {
    this.environment = options.environment ?? browserEnvironment();
    this.modules = options.modules ?? defaultModules;
  }
  start(delay = BACKGROUND_START_DELAY_MS) {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = this.environment.onInteraction(() => { this.lastInteraction = this.environment.now(); });
    this.arm(delay);
  }
  stop() {
    this.running = false;
    this.cancel?.(); this.cancel = null;
    this.unsubscribe?.(); this.unsubscribe = null;
  }
  /** The first reason collection must yield now, or null when it may continue. */
  pauseReason(): PauseReason | null {
    const env = this.environment;
    if (!this.running) return "stopped";
    if (!this.options.allowed()) return "disallowed";
    if (env.hidden()) return "hidden";
    if (!env.online()) return "offline";
    if (env.saveData()) return "save-data";
    if (env.reducedData()) return "reduced-data";
    if (env.lowBattery()) return "battery";
    if (this.options.client.retryAfterMs?.() || rateLimitLow(this.options.client.rateLimit?.())) return "rate-limit";
    if (this.options.busy()) return "busy";
    if (env.now() - this.lastInteraction < BACKGROUND_INTERACTION_QUIET_MS) return "interaction";
    return null;
  }
  private arm(ms: number) {
    this.cancel?.();
    if (!this.running) return;
    const cancelDelay = this.environment.delay(() => {
      this.cancel = this.environment.idle(() => { this.cancel = null; void this.tick(); }, BACKGROUND_IDLE_TIMEOUT_MS);
    }, ms);
    this.cancel = () => cancelDelay();
  }
  /** One portion: at most one repository, then reschedule. */
  async tick() {
    if (!this.running || this.working) return;
    const paused = this.pauseReason();
    if (paused) { this.lastPause = paused; this.arm(BACKGROUND_PAUSE_RETRY_MS); return; }
    this.working = true;
    let next = BACKGROUND_PORTION_GAP_MS;
    try {
      const found = await this.portion();
      if (found === "none") next = BACKGROUND_IDLE_RECHECK_MS;
      else if (found === "paused") next = BACKGROUND_PAUSE_RETRY_MS;
    } catch {
      // A failed lazy import (e.g. the network dropped before the shell was cached) is retried later (#143).
      next = BACKGROUND_PAUSE_RETRY_MS;
    } finally {
      this.working = false;
      this.arm(next);
    }
  }
  private async portion(): Promise<"done" | "none" | "paused" | "failed"> {
    const modules = await this.modules();
    const { token } = this.options;
    const now = this.environment.now();
    const cached = await modules.read(token, now);
    if (!this.deliveredCache && this.running) { this.deliveredCache = true; this.deliver(cached); }
    const repository = nextBackgroundRepository(this.options.repositories(), cached, modules.window(now), now, this.failures);
    if (!repository) return "none";
    const gate = this.gatedClient();
    const collector = modules.createCollector(gate.client);
    collector.restore(cached);
    try {
      const data = await collector.load(repository, now);
      // A refused request makes the collector fall back to partial data: never persist that.
      if (gate.paused()) { this.lastPause = gate.paused(); return "paused"; }
      const paused = this.pauseReason();
      if (paused === "stopped" || paused === "disallowed") { this.lastPause = paused; return "paused"; }
      if (data.temporary.length) this.failures.set(repository, now); else this.failures.delete(repository);
      // Merge with the latest cache, keeping selected repositories last so they are evicted last.
      const latest = await modules.read(token, this.environment.now());
      const selected = new Set(this.options.repositories().slice(0, BACKGROUND_REPOSITORIES));
      const others = latest.filter(entry => entry.repository !== repository);
      await modules.write(token, [...others.filter(entry => !selected.has(entry.repository)), ...others.filter(entry => selected.has(entry.repository)), data]);
      this.completed++;
      this.deliver([data]);
      return "done";
    } catch (error) {
      if (error instanceof BackgroundPaused || gate.paused()) { this.lastPause = gate.paused() || (error as BackgroundPaused).reason; return "paused"; }
      this.failures.set(repository, now);
      return "failed";
    } finally { collector.dispose(); }
  }
  private deliver(entries: StatisticsData[]) {
    for (const entry of entries) { try { this.options.collected?.(entry); } catch { /* A consumer failure never stops collection. */ } }
  }
  /** One request at a time, and each request first rechecks every pause condition. */
  private gatedClient() {
    let tail: Promise<unknown> = Promise.resolve();
    let refused: PauseReason | null = null;
    const source = this.options.client;
    const client: StatisticsClient = {
      request: <T>(path: string, options?: { store?: boolean }) => {
        const run = tail.then(() => {
          const reason = refused || this.pauseReason();
          if (reason) { refused = reason; throw new BackgroundPaused(reason); }
          return options ? source.request<T>(path, options) : source.request<T>(path);
        });
        tail = run.catch(() => undefined);
        return run;
      },
      retryAfterMs: () => source.retryAfterMs?.() || 0,
      // Reading the board's cached lists sends no request, so it needs no gate (#136).
      ...(source.boardIssues ? { boardIssues: (repository: string, since: string, maxAgeMs?: number, now?: number) => source.boardIssues!(repository, since, maxAgeMs, now) } : {}),
    };
    return { client, paused: () => refused };
  }
}
