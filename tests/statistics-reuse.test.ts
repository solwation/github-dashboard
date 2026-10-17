import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import type { Issue, Repo } from "../src/lib/model";
import { StatisticsCollector, type StatisticsClient } from "../src/lib/statistics-client";
import { StatisticsBackground, type BackgroundEnvironment } from "../src/lib/statistics-background";
import { statisticsWindow, summarizeStatistics, type StatisticsData } from "../src/lib/statistics";

// Fixture for #136: a board-synced repository with old, recent, reopened-after-closure and open issues.
const now = Date.parse("2026-10-16T15:00:00Z");
const repo: Repo = { id: 1, name: "repo", full_name: "sample/repo", description: null, private: true, html_url: "https://github.com/sample/repo", owner: { login: "sample" } };
const day = (value: string) => value.includes("T") ? value : `${value}T12:00:00Z`;
function issue(id: number, created: string, updated: string, closed: string | null, extra: Partial<Issue> = {}): Issue {
  return { id, number: id, title: `Issue ${id}`, state: closed ? "closed" : "open", labels: [{ name: id % 2 ? "bug" : "feature", color: "aaa" }], user: { login: id % 3 ? "alice" : "bob" },
    created_at: day(created), updated_at: day(updated), closed_at: closed && day(closed), html_url: `${repo.html_url}/issues/${id}`, assignees: [], ...extra } as Issue;
}
function fixture() {
  const issues: Issue[] = [];
  for (let id = 1; id <= 100; id++) issues.push(issue(id, "2026-08-01", "2026-08-02", "2026-08-02")); // Outside every window.
  for (let id = 101; id <= 140; id++) issues.push(issue(id, "2026-08-01", "2026-10-01", "2026-08-05")); // Old closure, updated in window.
  for (let id = 141; id <= 200; id++) issues.push(issue(id, "2026-07-01", "2026-07-02", null)); // Open, untouched.
  for (let id = 201; id <= 250; id++) issues.push(issue(id, "2026-10-02", "2026-10-11", id % 2 ? "2026-10-10" : null)); // Created in window.
  for (let id = 1001; id <= 1020; id++) issues.push(issue(id, "2026-10-03", "2026-10-04", null, { pull_request: {} } as Partial<Issue>));
  const events = Array.from({ length: 150 }, (_, index) => ({ id: 5000 - index, event: index % 3 ? "closed" : "reopened", created_at: day("2026-10-0" + (1 + index % 9)), actor: { login: "alice" }, issue: issues[200 + index % 50] }));
  const commits = Array.from({ length: 30 }, (_, index) => ({ sha: `c${index}`, parents: [{ sha: "p" }], author: { login: "alice" }, commit: { author: { name: "Alice", date: day("2026-10-1" + index % 6) }, committer: { date: day("2026-10-1" + index % 6) } } }));
  const pulls = Array.from({ length: 20 }, (_, index) => ({ id: 1001 + index, number: 1001 + index, created_at: day("2026-10-03"), updated_at: day("2026-10-04"), merged_at: null, closed_at: null, labels: [], user: { login: "alice" } }));
  return { issues, events, commits, pulls };
}
type Fixture = ReturnType<typeof fixture>;

/** A conditional GitHub fake: weak ETags per body, 304 on a match, `page` pagination by 100. */
function server(data: Fixture) {
  const log: { path: string; status: number; conditional: boolean }[] = [];
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    const url = new URL(input), q = url.searchParams, page = Number(q.get("page") || 1);
    let items: unknown[] | unknown;
    if (/\/issues$/.test(url.pathname)) {
      const since = q.get("since"), state = q.get("state");
      let list = data.issues.filter(item => state === "all" || item.state === state).filter(item => !since || Date.parse(item.updated_at) >= Date.parse(since));
      list = q.get("sort") === "created" ? list.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id) : list.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id);
      items = list;
    } else if (url.pathname.endsWith("/issues/events")) items = data.events;
    else if (url.pathname.endsWith("/labels")) items = [{ name: "bug", color: "aaa" }, { name: "feature", color: "aaa" }];
    else if (url.pathname.endsWith("/commits")) items = data.commits.filter(commit => !q.get("since") || commit.commit.committer.date >= q.get("since")!);
    else if (url.pathname.includes("/commits/")) items = { stats: { additions: 3, deletions: 1 }, files: [{ filename: "a.ts" }] };
    else if (url.pathname.endsWith("/pulls")) items = data.pulls;
    else items = [];
    let body = items, link = "";
    if (Array.isArray(items)) {
      body = items.slice((page - 1) * 100, page * 100);
      if (items.length > page * 100) { const next = new URL(url); next.searchParams.set("page", String(page + 1)); link = `<${next.href}>; rel="next"`; }
    }
    const text = JSON.stringify(body), etag = `W/"${text.length}-${[...text].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7)}"`;
    const conditional = (init.headers as Record<string, string>)["If-None-Match"] === etag;
    log.push({ path: url.pathname + url.search, status: conditional ? 304 : 200, conditional: "If-None-Match" in (init.headers as Record<string, string>) });
    return conditional ? new Response(null, { status: 304, headers: { etag } }) : new Response(text, { headers: { etag, ...(link ? { link } : {}) } });
  });
  vi.stubGlobal("fetch", fetch);
  return log;
}
const stats = (log: { path: string; status: number }[]) => ({
  calls: log.length, fresh: log.filter(entry => entry.status === 200).length, notModified: log.filter(entry => entry.status === 304).length,
  issueLists: log.filter(entry => /\/issues\?/.test(entry.path)).length,
});
const summary = (data: StatisticsData) => summarizeStatistics([data], { from: data.from, to: data.to, label: "", contributor: "" });
/** The collector's view of a client without board reuse: what the Statistics view did before #136. */
const withoutBoard = (github: GitHub): StatisticsClient => ({ request: (path, options) => github.request(path, options), retryAfterMs: () => github.retryAfterMs() });

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("statistics reuse the board's responses (#136)", () => {
  it("rebuilds the issue window from fresh board lists with no request and identical statistics", async () => {
    const data = fixture();
    const log = server(data);
    const github = new GitHub("token");
    await github.lane(repo, {});
    log.length = 0;
    const reused = await new StatisticsCollector(github).load(repo.full_name, now);
    const after = stats(log);
    log.length = 0;
    const direct = await new StatisticsCollector(withoutBoard(new GitHub("token"))).load(repo.full_name, now);
    const before = stats(log);
    // Same issues, same summary: closed-long-ago issues updated in the window come from the raw closed list.
    expect(reused.issues!.data.map(item => item.id).sort((a, b) => a - b)).toEqual(direct.issues!.data.map(item => item.id).sort((a, b) => a - b));
    expect(reused.issues!.complete).toBe(direct.issues!.complete);
    expect(summary(reused)).toEqual(summary(direct));
    expect(after.issueLists).toBe(0);
    expect(before.issueLists).toBe(2);
    expect(after.calls).toBe(before.calls - 2);
    // No request was repeated within the collection.
    expect(new Set(log.map(entry => entry.path)).size).toBe(log.length);
  });

  it("follows later board changes through the incremental since list and never serves stale or restored lists", async () => {
    const data = fixture();
    const log = server(data);
    const github = new GitHub("token");
    const lane = await github.lane(repo, {});
    vi.setSystemTime(now + 60_000);
    data.issues.push(issue(300, "2026-10-16T15:00:20Z", "2026-10-16T15:00:20Z", null));
    data.issues[150] = { ...data.issues[150]!, state: "closed", closed_at: "2026-10-16T15:00:30Z", updated_at: "2026-10-16T15:00:30Z" };
    await github.syncLane(lane, {}, now);
    log.length = 0;
    const later = now + 60_000;
    const reused = await new StatisticsCollector(github).load(repo.full_name, later);
    expect(stats(log).issueLists).toBe(0);
    const direct = await new StatisticsCollector(withoutBoard(new GitHub("token"))).load(repo.full_name, later);
    expect(reused.issues!.data.map(item => [item.id, item.updated_at]).sort()).toEqual(direct.issues!.data.map(item => [item.id, item.updated_at]).sort());
    expect(summary(reused)).toEqual(summary(direct));

    const since = `${statisticsWindow(later).from}T00:00:00Z`;
    expect(github.boardIssues(repo.full_name, since, 300_000, later)).not.toBeNull();
    // Older than one sync interval, before the board window, or never confirmed in this session: fetch instead.
    expect(github.boardIssues(repo.full_name, since, 300_000, later + 301_000)).toBeNull();
    expect(github.boardIssues(repo.full_name, "2026-09-01T00:00:00Z", 300_000, later)).toBeNull();
    expect(github.boardIssues("sample/other", since, 300_000, later)).toBeNull();
    const restored = new GitHub("token");
    restored.restoreResponses(github.exportResponses());
    expect(restored.boardIssues(repo.full_name, since, 300_000, later)).toBeNull();
    // A forced refresh asks GitHub even when the board is fresh.
    log.length = 0;
    await new StatisticsCollector(github).load(repo.full_name, later, true);
    expect(stats(log).issueLists).toBeGreaterThan(0);
  });

  it("rejects a lane load that is still running or failed part-way", async () => {
    const data = fixture();
    server(data);
    const github = new GitHub("token");
    const since = `${statisticsWindow(now).from}T00:00:00Z`;
    const pending = github.lane(repo, {});
    expect(github.boardIssues(repo.full_name, since)).toBeNull();
    await pending;
    expect(github.boardIssues(repo.full_name, since)).not.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    await expect(github.lane(repo, {})).rejects.toThrow();
    expect(github.boardIssues(repo.full_name, since)).toBeNull();
  });

  it("revalidates repeated collections as free 304s and keeps one-shot commit details out of the ETag cache (#108)", async () => {
    const data = fixture();
    const log = server(data);
    const github = new GitHub("token");
    await github.lane(repo, {});
    const first = new StatisticsCollector(github);
    await first.load(repo.full_name, now);
    const cached = github.exportResponses().map(([url]) => url);
    expect(cached.some(url => url.includes("/commits/"))).toBe(false);
    expect(cached.some(url => url.includes("state=open"))).toBe(true);
    // Six minutes later a new portion (or the opened view) restores the encrypted entry and revalidates it.
    vi.setSystemTime(now + 6 * 60_000);
    await github.lane(repo, {});
    log.length = 0;
    const next = new StatisticsCollector(github);
    next.restore(first.export());
    const result = await next.load(repo.full_name, now + 6 * 60_000);
    let counts = stats(log);
    expect(counts.issueLists).toBe(0);
    // Only the commit list moves to today's incremental anchor; everything else is a 304.
    expect(log.filter(entry => entry.status === 200).map(entry => entry.path)).toEqual(["/repos/sample/repo/commits?since=2026-10-16T00:00:00Z&per_page=100"]);
    expect(summary(result)).toEqual(summary(first.export()[0]!));
    vi.setSystemTime(now + 12 * 60_000);
    await github.lane(repo, {});
    log.length = 0;
    const third = new StatisticsCollector(github);
    third.restore(next.export());
    await third.load(repo.full_name, now + 12 * 60_000);
    counts = stats(log);
    expect(counts.fresh).toBe(0);
    expect(counts.notModified).toBe(counts.calls);
  });

  it("keeps the background gate in the request path while passing board reuse and store hints through", async () => {
    const data = fixture();
    const log = server(data);
    const github = new GitHub("token");
    await github.lane(repo, {});
    log.length = 0;
    let busy = false;
    const writes: StatisticsData[][] = [];
    const environment: BackgroundEnvironment = {
      now: () => now, hidden: () => false, online: () => true, saveData: () => false, reducedData: () => false, lowBattery: () => false,
      idle: () => () => undefined, delay: () => () => undefined, onInteraction: () => () => undefined,
    };
    const background = new StatisticsBackground({
      client: github, token: "token", repositories: () => [repo.full_name], busy: () => busy, allowed: () => true, environment,
      modules: async () => ({ createCollector: source => new StatisticsCollector(source), read: async () => writes.at(-1) ?? [], write: async (_token, entries) => { writes.push(entries); }, window: statisticsWindow }),
    });
    background.start();
    await background.tick();
    expect(writes).toHaveLength(1);
    expect(stats(log).issueLists).toBe(0);
    expect(writes[0]![0]!.issues!.data.length).toBeGreaterThan(0);
    expect(github.exportResponses().some(([url]) => url.includes("/commits/"))).toBe(false);
    // Paused: the board read alone never lets a portion through without the gate.
    busy = true; log.length = 0;
    vi.setSystemTime(now + 2 * 60 * 60_000);
    await background.tick();
    expect(log).toHaveLength(0);
    background.stop();
  });
});
