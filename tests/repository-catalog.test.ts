import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubApiError } from "../src/lib/github";
import type { Repo } from "../src/lib/model";
import { ProjectIconQueue, ProjectIconResolver } from "../src/lib/project-icon";
import { CATALOG_PICKER_FRESH_MS, CATALOG_RETRY_MS, CATALOG_REVALIDATE_MS, createCatalogRevalidation, mergeRepositoryCatalog } from "../src/lib/repository-catalog";

const repo = (full_name: string, extra: Partial<Repo> = {}) => ({ id: full_name.length, name: full_name.split("/")[1], full_name, private: false, description: "", ...extra }) as Repo;
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
afterEach(() => vi.useRealTimers());

function setup() {
  const state = { scope: ["client-a", 1, "alice"] as unknown[] | null, allowed: true, retryAfter: 0 };
  const fetch = vi.fn<() => Promise<Repo[]>>(async () => [repo("alice/one"), repo("alice/two")]);
  const apply = vi.fn<(repos: Repo[]) => void>();
  const catalog = createCatalogRevalidation({
    scope: () => state.scope, allowed: () => state.allowed, fetch, apply, retryAfterMs: () => state.retryAfter,
  });
  return { state, fetch, apply, catalog };
}

describe("repository catalog revalidation (#421)", () => {
  it("checks about hourly after sign-in and not before", async () => {
    vi.useFakeTimers();
    const { catalog, fetch, apply } = setup();
    catalog.markFresh();
    for (let minute = 1; minute < 60; minute++) { vi.advanceTimersByTime(60_000); await catalog.check(); }
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(await catalog.check()).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([repo("alice/one"), repo("alice/two")]);
    vi.advanceTimersByTime(CATALOG_REVALIDATE_MS - 1);
    await catalog.check();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("catches up one overdue check on resume instead of one per missed hour", async () => {
    vi.useFakeTimers();
    const { catalog, fetch } = setup();
    catalog.markFresh();
    vi.advanceTimersByTime(5 * CATALOG_REVALIDATE_MS); // hidden tab: the clock sent no ticks
    await Promise.all([catalog.check(), catalog.check(), catalog.check()]); // visibility + focus + minute tick
    expect(fetch).toHaveBeenCalledOnce();
    await catalog.check();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent checks into one request", async () => {
    const { catalog, fetch } = setup();
    const pending = deferred<Repo[]>();
    fetch.mockReturnValueOnce(pending.promise);
    const first = catalog.check(), second = catalog.check(CATALOG_PICKER_FRESH_MS);
    expect(fetch).toHaveBeenCalledOnce();
    pending.resolve([repo("alice/one")]);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
  });

  it("waits while offline or rate limited and resumes once allowed", async () => {
    const { catalog, fetch, state } = setup();
    state.allowed = false;
    expect(await catalog.check()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    state.allowed = true;
    expect(await catalog.check()).toBe(true);
  });

  it("ignores a late response from a previous account and checks the new account separately", async () => {
    const { catalog, fetch, apply, state } = setup();
    const late = deferred<Repo[]>();
    fetch.mockReturnValueOnce(late.promise);
    const old = catalog.check();
    state.scope = ["client-b", 2, "bob"];
    fetch.mockResolvedValueOnce([repo("bob/own")]);
    expect(await catalog.check()).toBe(true);
    expect(apply).toHaveBeenLastCalledWith([repo("bob/own")]);
    late.resolve([repo("alice/secret")]);
    expect(await old).toBe(false);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalledWith([repo("alice/secret")]);
  });

  it("ignores a late failure from a previous account without delaying the new one", async () => {
    vi.useFakeTimers();
    const { catalog, fetch, state } = setup();
    const late = deferred<Repo[]>();
    fetch.mockReturnValueOnce(late.promise);
    const old = catalog.check();
    state.scope = ["client-b", 2, "bob"];
    catalog.markFresh();
    late.reject(new GitHubApiError("limited", 429, false, true));
    expect(await old).toBe(false);
    vi.advanceTimersByTime(CATALOG_REVALIDATE_MS);
    expect(await catalog.check()).toBe(true);
  });

  it("keeps the last list on errors and honours Retry-After before retrying", async () => {
    vi.useFakeTimers();
    const { catalog, fetch, apply, state } = setup();
    fetch.mockRejectedValueOnce(new GitHubApiError("limited", 403, false, true));
    state.retryAfter = 30 * 60_000;
    expect(await catalog.check()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30 * 60_000 - 1);
    await catalog.check();
    expect(fetch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(await catalog.check()).toBe(true);

    vi.advanceTimersByTime(CATALOG_REVALIDATE_MS);
    state.retryAfter = 0;
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await catalog.check()).toBe(false);
    vi.advanceTimersByTime(CATALOG_RETRY_MS - 1);
    await catalog.check();
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(await catalog.check()).toBe(true);
  });

  it("does nothing without a signed-in scope", async () => {
    const { catalog, fetch, state } = setup();
    state.scope = null;
    expect(await catalog.check()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("revalidates a stale catalog sooner when the picker opens", async () => {
    vi.useFakeTimers();
    const { catalog, fetch } = setup();
    catalog.markFresh();
    vi.advanceTimersByTime(CATALOG_PICKER_FRESH_MS - 1);
    await catalog.check(CATALOG_PICKER_FRESH_MS);
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(await catalog.check(CATALOG_PICKER_FRESH_MS)).toBe(true);
  });
});

describe("merging a revalidated catalog", () => {
  it("adds new repositories without selecting them and keeps icons and selected entries", () => {
    const icon = { data: null, checkedAt: 1, emptyVersion: 2 as const };
    const previous = [repo("alice/one", { projectIcon: icon }), repo("alice/gone-selected"), repo("alice/gone")];
    const merged = mergeRepositoryCatalog(previous, [repo("alice/new"), repo("alice/one", { description: "updated" }), repo("alice/new")], ["alice/gone-selected"]);
    expect(merged.map(item => item.full_name)).toEqual(["alice/new", "alice/one", "alice/gone-selected"]);
    expect(merged[1]).toMatchObject({ description: "updated", projectIcon: icon });
  });
});

describe("picker icon queue", () => {
  it("looks up visible rows with bounded concurrency, once each, dropping rows scrolled away", async () => {
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<void>>>();
    const queue = new ProjectIconQueue(name => { started.push(name); const gate = deferred<void>(); gates.set(name, gate); return gate.promise; }, 3);
    for (const name of ["a/1", "a/2", "a/3", "a/4", "a/5"]) queue.add(name);
    queue.add("a/1");
    await Promise.resolve(); await Promise.resolve();
    expect(started).toEqual(["a/1", "a/2", "a/3"]);
    expect(queue.active).toBe(3);
    queue.remove("a/4");
    gates.get("a/1")!.resolve();
    await vi.waitFor(() => expect(started).toEqual(["a/1", "a/2", "a/3", "a/5"]));
    gates.get("a/2")!.reject(new Error("offline"));
    gates.get("a/3")!.resolve(); gates.get("a/5")!.resolve();
    await vi.waitFor(() => expect(queue.active).toBe(0));
    queue.add("a/4");
    await vi.waitFor(() => expect(started.at(-1)).toBe("a/4"));
  });

  it("reuses the resolver cache and deduplicates the board's concurrent lookup", async () => {
    const request = vi.fn(async () => []);
    const resolver = new ProjectIconResolver(request);
    const queue = new ProjectIconQueue(name => resolver.get(name), 3);
    const board = resolver.get("a/1");
    queue.add("a/1"); queue.add("a/2");
    await board;
    await vi.waitFor(() => expect(queue.active).toBe(0));
    expect(request.mock.calls.map(call => (call as unknown[])[0])).toEqual(["/repos/a/1/contents", "/repos/a/2/contents"]);
    queue.clear(); queue.add("a/1");
    await vi.waitFor(() => expect(queue.active).toBe(0));
    expect(request).toHaveBeenCalledTimes(2);
  });
});
