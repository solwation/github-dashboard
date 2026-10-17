import { describe, expect, it } from "vitest";
import {
  BACKGROUND_INTERACTION_QUIET_MS, BACKGROUND_PAUSE_RETRY_MS, BACKGROUND_PORTION_GAP_MS, BACKGROUND_STALE_MS, BACKGROUND_START_DELAY_MS, BACKGROUND_IDLE_RECHECK_MS,
  StatisticsBackground, nextBackgroundRepository, rateLimitLow,
  type BackgroundEnvironment, type BackgroundModules, type BackgroundStatisticsClient, type RateLimitInfo,
} from "../src/lib/statistics-background";
import { StatisticsCollector } from "../src/lib/statistics-client";
import { statisticsWindow, type StatisticsData } from "../src/lib/statistics";

const now = Date.parse("2026-10-16T15:00:00Z");
const issue = { id: 1, number: 1, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-13T00:00:00Z", labels: [], user: { login: "alice" } };
const commit = { sha: "first", parents: [{ sha: "parent" }], author: { login: "alice" }, commit: { author: { name: "Alice", date: "2026-10-12T01:00:00Z" }, committer: { date: "2026-10-12T02:00:00Z" } } };
function reply(url: URL) {
  if (url.pathname.endsWith("/issues/events")) return { data: [], next: null };
  if (url.pathname.endsWith("/issues")) return { data: [issue], next: null };
  if (url.pathname.endsWith("/commits")) return { data: [commit], next: null };
  if (url.pathname.includes("/commits/")) return { data: { stats: { additions: 1, deletions: 1 }, files: [{ filename: "a.ts" }] }, next: null };
  return { data: [], next: null };
}

function harness(options: { repositories?: string[]; cache?: StatisticsData[]; onRequest?: (url: URL) => void; rate?: RateLimitInfo | null; collected?: (data: StatisticsData) => void; failedImports?: number } = {}) {
  let clock = now;
  const state = { hidden: false, online: true, saveData: false, reducedData: false, lowBattery: false, busy: false, allowed: true, retry: 0, rate: options.rate ?? null as RateLimitInfo | null };
  const timers: { at: number; run: () => void; idle: boolean }[] = [];
  const interactions: (() => void)[] = [];
  let concurrent = 0, peak = 0;
  const calls: URL[] = [];
  const client: BackgroundStatisticsClient = {
    async request<T>(path: string) {
      const url = new URL(path, "https://api.github.com"); calls.push(url);
      concurrent++; peak = Math.max(peak, concurrent);
      try { await Promise.resolve(); options.onRequest?.(url); return reply(url) as { data: T; next: string | null }; }
      finally { concurrent--; }
    },
    retryAfterMs: () => state.retry,
    rateLimit: () => state.rate,
  };
  let cache = options.cache ?? [];
  let importFailures = 0;
  const writes: StatisticsData[][] = [];
  const modules: BackgroundModules = {
    createCollector: source => new StatisticsCollector(source),
    read: async () => cache,
    write: async (_token, entries) => { writes.push(entries); cache = entries; },
    window: statisticsWindow,
  };
  const environment: BackgroundEnvironment = {
    now: () => clock,
    hidden: () => state.hidden, online: () => state.online, saveData: () => state.saveData, reducedData: () => state.reducedData, lowBattery: () => state.lowBattery,
    idle(callback) { const timer = { at: clock, run: callback, idle: true }; timers.push(timer); return () => { timers.splice(timers.indexOf(timer) >>> 0, 1); }; },
    delay(callback, ms) { const timer = { at: clock + ms, run: callback, idle: false }; timers.push(timer); return () => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1); }; },
    onInteraction(callback) { interactions.push(callback); return () => { interactions.splice(interactions.indexOf(callback), 1); }; },
  };
  const background = new StatisticsBackground({
    client, token: "token", repositories: () => options.repositories ?? ["sample/one"],
    busy: () => state.busy, allowed: () => state.allowed, modules: async () => { if ((options.failedImports ?? 0) > importFailures) { importFailures++; throw new TypeError("Failed to fetch dynamically imported module"); } return modules; }, environment,
    ...(options.collected ? { collected: options.collected } : {}),
  });
  /** Advance the fake clock to the next timer and run it, letting async work settle. */
  async function step() {
    timers.sort((a, b) => a.at - b.at);
    const timer = timers.shift();
    if (!timer) return null;
    clock = Math.max(clock, timer.at); timer.run();
    for (let i = 0; i < 50; i++) await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    return timer;
  }
  async function cycle() { await step(); await step(); } // delay, then idle callback
  return { background, state, timers, calls, writes, interactions, step, cycle, peak: () => peak, cache: () => cache, advance: (ms: number) => { clock += ms; } };
}

describe("background statistics scheduling", () => {
  it("waits for a startup delay and an idle callback, then stores missing statistics", async () => {
    const h = harness();
    h.background.start();
    expect(h.timers).toEqual([expect.objectContaining({ at: now + BACKGROUND_START_DELAY_MS, idle: false })]);
    await h.step();
    expect(h.calls).toHaveLength(0);
    expect(h.timers[0]).toEqual(expect.objectContaining({ idle: true }));
    await h.step();
    expect(h.writes).toHaveLength(1);
    expect(h.cache().map(entry => entry.repository)).toEqual(["sample/one"]);
    expect(h.cache()[0]!.commits!.data).toHaveLength(1);
    expect(h.peak()).toBe(1);
    expect(h.timers[0]).toEqual(expect.objectContaining({ at: now + BACKGROUND_START_DELAY_MS + BACKGROUND_PORTION_GAP_MS }));
  });
  it("retries a portion whose lazy module import failed instead of stopping (#143)", async () => {
    const h = harness({ failedImports: 1 });
    h.background.start(0);
    await h.cycle();
    expect(h.writes).toHaveLength(0);
    expect(h.timers[0]).toEqual(expect.objectContaining({ idle: false }));
    await h.cycle();
    expect(h.writes).toHaveLength(1);
    expect(h.cache().map(entry => entry.repository)).toEqual(["sample/one"]);
  });
  it("hands cached statistics once per run and each new collection to the board (#141)", async () => {
    const delivered: string[] = [];
    const old = { repository: "sample/two", ...statisticsWindow(now - 1000), fetchedAt: now - 1000, issues: null, events: null, commits: null, changes: null, pulls: null, temporary: [] } as StatisticsData;
    const h = harness({ repositories: ["sample/one", "sample/two"], cache: [old], collected: data => { delivered.push(`${data.repository}@${data.fetchedAt === old.fetchedAt ? "cache" : "new"}`); throw new Error("ignored"); } });
    h.background.start(0);
    await h.cycle();
    expect(delivered).toEqual(["sample/two@cache", "sample/one@new"]);
    await h.cycle();
    expect(delivered).toEqual(["sample/two@cache", "sample/one@new"]);
    expect(h.writes).toHaveLength(1);
  });
  it("collects one repository per portion, missing first, and idles once everything is fresh", async () => {
    const h = harness({ repositories: ["sample/one", "sample/two"] });
    h.background.start(0);
    await h.cycle();
    expect(h.cache().map(entry => entry.repository)).toEqual(["sample/one"]);
    await h.cycle();
    expect(h.cache().map(entry => entry.repository)).toEqual(["sample/one", "sample/two"]);
    const requests = h.calls.length;
    await h.cycle();
    expect(h.calls.length).toBe(requests);
    expect(h.writes).toHaveLength(2);
    expect(h.timers[0]!.at - (now + 2 * BACKGROUND_PORTION_GAP_MS)).toBe(BACKGROUND_IDLE_RECHECK_MS);
  });
  it("selects missing, stale or outdated repositories within the ten repository limit", () => {
    const window = statisticsWindow(now);
    const entry = (repository: string, fetchedAt: number, extra: Partial<StatisticsData> = {}) => ({ repository, ...statisticsWindow(fetchedAt), fetchedAt, issues: null, events: null, commits: null, changes: null, pulls: null, temporary: [], ...extra }) as StatisticsData;
    const failures = new Map<string, number>();
    expect(nextBackgroundRepository(["a/a", "b/b"], [entry("a/a", now - 1000)], window, now, failures)).toBe("b/b");
    expect(nextBackgroundRepository(["a/a", "b/b"], [entry("a/a", now - BACKGROUND_STALE_MS - 1), entry("b/b", now - BACKGROUND_STALE_MS - 5)], window, now, failures)).toBe("b/b");
    expect(nextBackgroundRepository(["a/a"], [entry("a/a", now - 1000, { temporary: ["issues"] })], window, now, failures)).toBe("a/a");
    expect(nextBackgroundRepository(["a/a"], [entry("a/a", now - 1000)], window, now, failures)).toBeNull();
    expect(nextBackgroundRepository(Array.from({ length: 11 }, (_, i) => `r/r${i}`), Array.from({ length: 10 }, (_, i) => entry(`r/r${i}`, now - 1000)), window, now, failures)).toBeNull();
    failures.set("b/b", now - 1000);
    expect(nextBackgroundRepository(["b/b"], [], window, now, failures)).toBeNull();
  });
  it("orders writes so unselected repositories are evicted before selected ones", async () => {
    const old = { repository: "other/repo", ...statisticsWindow(now), fetchedAt: now - 1000, issues: null, events: null, commits: null, changes: null, pulls: null, temporary: [] } as StatisticsData;
    const h = harness({ cache: [old] });
    h.background.start(0);
    await h.cycle();
    expect(h.cache().map(entry => entry.repository)).toEqual(["other/repo", "sample/one"]);
  });
  it("stops cleanly without further timers or writes", async () => {
    const h = harness();
    h.background.start(0);
    h.background.stop();
    expect(h.timers).toHaveLength(0);
    expect(h.interactions).toHaveLength(0);
    expect(await h.step()).toBeNull();
    expect(h.writes).toHaveLength(0);
  });
});

describe("background statistics pause conditions", () => {
  const conditions: [string, (state: ReturnType<typeof harness>["state"]) => void][] = [
    ["hidden", state => { state.hidden = true; }],
    ["offline", state => { state.online = false; }],
    ["save-data", state => { state.saveData = true; }],
    ["reduced-data", state => { state.reducedData = true; }],
    ["battery", state => { state.lowBattery = true; }],
    ["rate-limit", state => { state.rate = { remaining: 900, limit: 5000, resetAt: now + 3600000 }; }],
    ["rate-limit", state => { state.retry = 60000; }],
    ["busy", state => { state.busy = true; }],
    ["disallowed", state => { state.allowed = false; }],
  ];
  for (const [reason, apply] of conditions) {
    it(`pauses before collecting while ${reason} and resumes afterwards`, async () => {
      const h = harness();
      apply(h.state);
      h.background.start(0);
      await h.cycle();
      expect(h.calls).toHaveLength(0);
      expect(h.background.lastPause).toBe(reason);
      expect(h.timers[0]!.at).toBe(now + BACKGROUND_PAUSE_RETRY_MS);
      Object.assign(h.state, { hidden: false, online: true, saveData: false, reducedData: false, lowBattery: false, busy: false, allowed: true, retry: 0, rate: null });
      await h.cycle();
      expect(h.writes).toHaveLength(1);
    });
  }
  it("yields to user interaction until a quiet period has passed", async () => {
    const h = harness();
    h.background.start(0);
    h.interactions.forEach(callback => callback());
    await h.cycle();
    expect(h.background.lastPause).toBe("interaction");
    expect(h.calls).toHaveLength(0);
    expect(BACKGROUND_PAUSE_RETRY_MS).toBeGreaterThan(BACKGROUND_INTERACTION_QUIET_MS);
    await h.cycle();
    expect(h.writes).toHaveLength(1);
  });
  it("aborts a running portion as soon as board sync starts and never stores the partial result", async () => {
    let started = false;
    const h = harness({ onRequest: () => { if (!started) { started = true; h.state.busy = true; } } });
    h.background.start(0);
    await h.cycle();
    expect(h.calls).toHaveLength(1);
    expect(h.background.lastPause).toBe("busy");
    expect(h.writes).toHaveLength(0);
    h.state.busy = false;
    await h.cycle();
    expect(h.writes).toHaveLength(1);
    expect(h.cache()[0]!.temporary).toEqual([]);
  });
  it("stops issuing requests when user interaction or a low rate-limit reserve appears mid-portion", async () => {
    const h = harness({ onRequest: () => { h.interactions.forEach(callback => callback()); } });
    h.background.start(0);
    await h.cycle();
    expect(h.calls).toHaveLength(1);
    expect(h.background.lastPause).toBe("interaction");
    const r = harness({ onRequest: () => { r.state.rate = { remaining: 10, limit: 5000, resetAt: now + 1000 }; } });
    r.background.start(0);
    await r.cycle();
    expect(r.calls).toHaveLength(1);
    expect(r.background.lastPause).toBe("rate-limit");
    expect(r.writes).toHaveLength(0);
  });
  it("keeps a reserve of the larger of an absolute margin and a quarter of the quota", () => {
    expect(rateLimitLow(null)).toBe(false);
    expect(rateLimitLow({ remaining: 4000, limit: 5000, resetAt: now })).toBe(false);
    expect(rateLimitLow({ remaining: 1200, limit: 5000, resetAt: now })).toBe(true);
    expect(rateLimitLow({ remaining: 999, limit: 1000, resetAt: now })).toBe(true);
    expect(rateLimitLow({ remaining: 3000, limit: 15000, resetAt: now })).toBe(true);
  });
});
