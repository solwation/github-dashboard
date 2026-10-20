import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACKGROUND_CHECK_TAG, appVisible, notificationFor, notificationTag, runBackgroundCheck, statusNotices, timeoutNotices, watchSettings,
  type BackgroundApi, type BackgroundDependencies, type BackgroundState, type StoredRepo,
} from "../src/lib/background-check";
import { closureKey } from "../src/lib/closures";
import { setLanguage } from "../src/lib/i18n";
import type { Issue, Lane, Repo } from "../src/lib/model";

afterEach(() => setLanguage("auto"));
const NOW = Date.parse("2026-10-17T12:00:00Z");
const repo: Repo = { id: 7, name: "board", full_name: "acme/board", description: null, private: true, html_url: "https://github.com/acme/board", owner: { login: "acme" } };
const issue = (id: number, patch: Partial<Issue> = {}): Issue => ({
  id, number: id, title: `Issue ${id}`, html_url: `https://github.com/acme/board/issues/${id}`, state: "open",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-17T10:00:00Z", closed_at: null, labels: [], assignees: [], ...patch,
});
const progress = { labels: [{ name: "in progress", color: "fff" }] };
const closed = (at = "2026-10-17T11:30:00Z") => ({ state: "closed", closed_at: at });
const stored = (issues: Issue[], patch: Partial<StoredRepo> = {}): StoredRepo => ({
  repo, since: NOW - 3600000, checkedAt: NOW - 600000, rules: "[]", labels: [], issues, ...patch,
});
const lane = (issues: Issue[]): Lane => ({ repo, issues, labels: [] });
const settings = { selected: ["acme/board", "acme/quiet"], notificationRepos: ["acme/board"], rules: {}, preferences: { language: "en" } };

describe("background comparison", () => {
  it("uses the shared periodic sync tag", () => expect(BACKGROUND_CHECK_TAG).toBe("issueflow-check"));
  it("watches only selected repositories with notifications enabled", () => {
    expect(watchSettings(settings).repos).toEqual(["acme/board"]);
    expect(watchSettings({ selected: ["acme/board"], notificationRepos: [] }).repos).toEqual([]);
    expect(watchSettings({ selected: [], notificationRepos: ["acme/board"] }).repos).toEqual([]);
    expect(watchSettings(null)).toMatchObject({ repos: [], hideCoordination: true, timeoutEnabled: true, timeoutOverrunPercent: 25 });
  });
  it("reports closures, reopenings and progress moves but not unchanged or pull request items", () => {
    const before = stored([issue(1), issue(2, progress), issue(3, closed("2026-10-10T00:00:00Z")), issue(4, progress), issue(5), issue(6, { pull_request: {} })]);
    const after = lane([issue(1, closed()), issue(2), issue(3), issue(4, progress), issue(5, progress), issue(6, { pull_request: {}, ...closed() }), issue(8, closed("2026-10-17T11:55:00Z"))]);
    expect(statusNotices(before, after).map(n => [n.kind, n.issue.id])).toEqual([
      ["closed", 1], ["backlog", 2], ["reopened", 3], ["progress", 5], ["closed", 8],
    ]);
  });
  it("ignores unknown issues closed before the previous check and hidden coordination issues", () => {
    const coordination = issue(2, { ...closed(), labels: [{ name: "orkester", color: "000" }] });
    const before = stored([issue(2, { labels: coordination.labels })]);
    expect(statusNotices(before, lane([issue(1, closed("2026-10-16T00:00:00Z")), coordination]))).toEqual([]);
    expect(statusNotices(before, lane([coordination]), {}, false).map(n => n.kind)).toEqual(["closed"]);
  });
  it("notifies a timeout once, when the work period crosses the threshold between checks", () => {
    const started = new Date(NOW - 35 * 60000).toISOString(); // Crossed 30 minutes five minutes ago.
    const old = new Date(NOW - 120 * 60000).toISOString(); // Already over the threshold at the previous check.
    const history = [101, 102, 103].map(id => issue(id, { ...closed(new Date(NOW - 3600000).toISOString()), workStartedAt: new Date(NOW - 5400000).toISOString() }));
    const items = [issue(1, { ...progress, startedAt: started }), issue(2, { ...progress, startedAt: old }), ...history];
    expect(timeoutNotices(stored(items), lane(items), {}, { timeoutEnabled: true, timeoutOverrunPercent: 0 }, NOW)).toEqual([]);
    expect(timeoutNotices(stored(items, { timeoutSettings: { timeoutEnabled: true, timeoutOverrunPercent: 0 } }), lane(items), {}, { timeoutEnabled: true, timeoutOverrunPercent: 0 }, NOW).map(n => n.issue.id)).toEqual([1]);
    expect(timeoutNotices(stored(items, { checkedAt: NOW - 60000, timeoutSettings: { timeoutEnabled: true, timeoutOverrunPercent: 0 } }), lane(items), {}, { timeoutEnabled: true, timeoutOverrunPercent: 0 }, NOW)).toEqual([]);
  });
  it("builds app-focused notifications whose tags match the open app's notifications", () => {
    setLanguage("en");
    const done = issue(1, closed());
    const request = notificationFor({ kind: "closed", repo, issue: done }, "https://example.test/board/");
    expect(request).toEqual({ title: "board · Issue closed", options: {
      body: "#1 Issue 1", tag: closureKey(repo.full_name, done), icon: "https://example.test/board/favicon.svg",
      data: { app: "https://example.test/board/#repo-7", url: done.html_url },
    } });
    const timed = issue(2, { startedAt: "2026-10-17T11:00:00.000Z" });
    expect(notificationTag({ kind: "timeout", repo, issue: timed })).toBe(`timeout:acme/board:2:2026-10-17T11:00:00.000Z`);
  });
  it("detects a visible app window", async () => {
    const clients = (states: string[]) => ({ matchAll: vi.fn().mockResolvedValue(states.map(visibilityState => ({ visibilityState }))) });
    expect(await appVisible(clients(["hidden", "visible"]))).toBe(true);
    expect(await appVisible(clients(["hidden"]))).toBe(false);
    expect(await appVisible(clients([]))).toBe(false);
  });
});

function harness(options: { token?: string | null; state?: unknown; settings?: unknown; lane?: Issue[]; permission?: string; visible?: boolean; existing?: boolean } = {}) {
  const api = {
    user: vi.fn().mockResolvedValue({ login: "octo", avatar_url: "" }),
    request: vi.fn().mockResolvedValue({ data: repo, next: null }),
    lane: vi.fn(async (r: Repo) => ({ repo: r, issues: options.lane ?? [], labels: [] })),
    syncLane: vi.fn(async (previous: Lane) => ({ repo: previous.repo, issues: options.lane ?? previous.issues, labels: [] })),
    exportResponses: vi.fn().mockReturnValue([]),
    restoreResponses: vi.fn(),
    retryAfterMs: vi.fn().mockReturnValue(0),
  } satisfies Record<keyof BackgroundApi, unknown>;
  const saved: BackgroundState[] = [];
  const shown: string[] = [];
  const deps: BackgroundDependencies = {
    permission: () => options.permission ?? "granted",
    loadToken: vi.fn().mockResolvedValue(options.token === undefined ? "token" : options.token),
    loadState: vi.fn().mockResolvedValue(options.state ?? null),
    saveState: vi.fn(async (_token: string, state: BackgroundState) => { saved.push(structuredClone(state)); }),
    loadSettings: vi.fn().mockResolvedValue(options.settings ?? settings),
    api: () => api as unknown as BackgroundApi,
    appVisible: vi.fn().mockResolvedValue(options.visible ?? false),
    existing: vi.fn().mockResolvedValue(options.existing ?? false),
    show: vi.fn(async request => { shown.push(request.options.tag); }),
    root: "https://example.test/board/",
    now: () => NOW,
  };
  return { api, deps, saved, shown };
}
const previousState = (issues: Issue[]): BackgroundState => ({ version: 1, login: "octo", repos: { "acme/board": stored(issues) }, responses: [] });

describe("background check", () => {
  it("does nothing when logged out or notifications are not granted", async () => {
    for (const run of [harness({ token: null }), harness({ permission: "denied" })]) {
      expect(await runBackgroundCheck(run.deps)).toBe(0);
      expect(run.api.user).not.toHaveBeenCalled();
      expect(run.deps.saveState).not.toHaveBeenCalled();
    }
  });
  it("stores a silent baseline on the first run and fetches only watched repositories", async () => {
    const run = harness({ lane: [issue(1, closed())] });
    expect(await runBackgroundCheck(run.deps)).toBe(0);
    expect(run.api.lane).toHaveBeenCalledOnce();
    expect(run.api.lane.mock.calls[0]![0].full_name).toBe("acme/board");
    expect(run.api.request).toHaveBeenCalledWith("/repos/acme/board", { store: false });
    expect(Object.keys(run.saved[0]!.repos)).toEqual(["acme/board"]);
    expect(run.saved[0]!.repos["acme/board"]).toMatchObject({ since: NOW, checkedAt: NOW });
    expect(run.shown).toEqual([]);
  });
  it("sends no notifications for repositories without notifications enabled", async () => {
    const run = harness({ settings: { ...settings, notificationRepos: [] }, state: previousState([issue(1)]), lane: [issue(1, closed())] });
    expect(await runBackgroundCheck(run.deps)).toBe(0);
    expect(run.api.syncLane).not.toHaveBeenCalled();
    expect(run.api.lane).not.toHaveBeenCalled();
    expect(run.saved[0]!.repos).toEqual({});
  });
  it("revalidates with the stored since anchor and notifies changes, saving state first", async () => {
    const run = harness({ state: previousState([issue(1), issue(2)]), lane: [issue(1, closed()), issue(2, progress)] });
    expect(await runBackgroundCheck(run.deps)).toBe(2);
    expect(run.api.syncLane).toHaveBeenCalledWith(expect.objectContaining({ repo }), {}, NOW - 3600000, { labels: false });
    expect(run.shown).toEqual([closureKey("acme/board", issue(1, closed())), "progress:acme/board:2:2026-10-17T10:00:00Z"]);
    expect((run.deps.saveState as any).mock.invocationCallOrder[0]).toBeLessThan((run.deps.show as any).mock.invocationCallOrder[0]);
    expect(run.saved[0]!.repos["acme/board"]!.issues.map(i => i.state)).toEqual(["closed", "open"]);
  });
  it("leaves notifying to a visible app but still updates the baseline", async () => {
    const run = harness({ visible: true, state: previousState([issue(1)]), lane: [issue(1, closed())] });
    expect(await runBackgroundCheck(run.deps)).toBe(0);
    expect(run.shown).toEqual([]);
    expect(run.saved[0]!.repos["acme/board"]!.issues[0]!.state).toBe("closed");
  });
  it("skips a notification already displayed with the same tag", async () => {
    const run = harness({ existing: true, state: previousState([issue(1)]), lane: [issue(1, closed())] });
    expect(await runBackgroundCheck(run.deps)).toBe(0);
    expect(run.deps.show).not.toHaveBeenCalled();
  });
  it("never notifies when the new state cannot be saved, and swallows every error", async () => {
    const run = harness({ state: previousState([issue(1)]), lane: [issue(1, closed())] });
    run.deps.saveState = vi.fn().mockRejectedValue(new Error("quota"));
    expect(await runBackgroundCheck(run.deps)).toBe(0);
    expect(run.deps.show).not.toHaveBeenCalled();
    const failing = harness();
    failing.api.user.mockRejectedValue(new Error("offline"));
    await expect(runBackgroundCheck(failing.deps)).resolves.toBe(0);
  });
  it("keeps the previous baseline of a repository whose check failed", async () => {
    const run = harness({ state: previousState([issue(1)]) });
    run.api.syncLane.mockRejectedValue(new Error("502"));
    expect(await runBackgroundCheck(run.deps)).toBe(0);
    expect(run.saved[0]!.repos["acme/board"]).toEqual(stored([issue(1)]));
  });
  it("treats state from another account or stale state as a silent baseline", async () => {
    const other = harness({ state: { ...previousState([issue(1)]), login: "someone" }, lane: [issue(1, closed())] });
    expect(await runBackgroundCheck(other.deps)).toBe(0);
    expect(other.api.lane).toHaveBeenCalledOnce();
    const stale = previousState([issue(1)]);
    stale.repos["acme/board"]!.checkedAt = NOW - 2 * 86400000;
    const old = harness({ state: stale, lane: [issue(1, closed())] });
    expect(await runBackgroundCheck(old.deps)).toBe(0);
    expect(old.api.lane).toHaveBeenCalledOnce();
  });
});
