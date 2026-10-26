import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { GitHub } from "../src/lib/github";
import { IssueRelationsCache, parseIssueRelations, RELATIONS_TTL_MS, subIssueProgress, type IssueRelations } from "../src/lib/issue-relations";
import type { Issue } from "../src/lib/model";
const parent = { number: 42, title: "Parent plan", url: "https://github.com/other/plans/issues/42" };
const response = (issue: unknown, errors?: unknown[]) => ({ data: { repository: { issue } }, errors });
const issue = (number = 1) => ({ id: number, number, updated_at: "2026-10-16T10:00:00Z" });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("native issue relations", () => {
  it("keeps a cross-repository parent and genuine zero completed progress", () => {
    expect(parseIssueRelations(response({ parent, subIssuesSummary: { total: 5, completed: 0 } }))).toEqual({
      parent: { ...parent, repository: "other/plans" }, progress: { total: 5, completed: 0 },
    });
    expect(subIssueProgress({ total: 5, completed: 5 })).toEqual({ total: 5, completed: 5 });
    for (const value of [null, {}, { total: 0, completed: 0 }, { total: -1, completed: 0 }, { total: 5, completed: 6 }, { total: 5, completed: -1 }, { total: 1.5, completed: 1 }]) expect(subIssueProgress(value)).toBeNull();
  });
  it("hides absent or unsafe parent links while preserving independent progress", () => {
    for (const url of ["javascript:alert(1)", "https://example.com/other/plans/issues/42", "https://user@github.com/other/plans/issues/42", "https://github.com/other/plans/issues/99", "https://github.com/other/plans/pull/42"]) {
      expect(parseIssueRelations(response({ parent: { ...parent, url }, subIssuesSummary: { total: 3, completed: 2 } }))).toEqual({ parent: null, progress: { total: 3, completed: 2 } });
    }
    expect(parseIssueRelations(response({ parent: null, subIssuesSummary: { total: 0, completed: 0 } }))).toEqual({ parent: null, progress: null });
    expect(parseIssueRelations({ errors: [{ message: "Access denied" }] })).toBeNull();
    expect(parseIssueRelations(response(null))).toBeNull();
  });
  it("accepts available fields of partial GraphQL responses without inventing unavailable metrics", () => {
    const value = { parent, subIssuesSummary: { total: 3, completed: 2 } };
    expect(parseIssueRelations(response(value, [{ path: ["repository", "issue", "parent"] }]))).toEqual({ parent: null, progress: { total: 3, completed: 2 } });
    expect(parseIssueRelations(response(value, [{ path: ["repository", "issue", "subIssuesSummary"] }]))?.parent?.number).toBe(42);
    expect(parseIssueRelations(response(value, [{ path: ["repository", "issue"] }]))).toEqual({ parent: null, progress: null });
  });
  it("deduplicates pending requests and revalidates expired, updated or explicitly refreshed relations", async () => {
    vi.useFakeTimers();
    let complete!: (value: IssueRelations | null) => void;
    const empty: IssueRelations = { parent: null, progress: null };
    const fetch = vi.fn(() => new Promise<IssueRelations | null>(resolve => { complete = resolve; }));
    const cache = new IssueRelationsCache(fetch);
    const first = cache.get("owner/repo", issue());
    expect(cache.get("owner/repo", issue())).toBe(first);
    complete(empty); await first;
    await cache.get("owner/repo", issue());
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELATIONS_TTL_MS);
    const next = cache.get("owner/repo", issue()); complete(empty); await next;
    expect(fetch).toHaveBeenCalledTimes(2);
    const changed = cache.get("owner/repo", { ...issue(), updated_at: "later" }); complete(empty); await changed;
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.clear();
    const refreshed = cache.get("owner/repo", issue()); complete(empty); await refreshed;
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("clears only the named repositories so a targeted refresh keeps other repositories' relations (#149)", async () => {
    const empty: IssueRelations = { parent: null, progress: null };
    const fetch = vi.fn(async () => empty);
    const cache = new IssueRelationsCache(fetch);
    await cache.get("owner/one", issue()); await cache.get("owner/two", issue());
    expect(fetch).toHaveBeenCalledTimes(2);
    cache.clear(["owner/one"]);
    await cache.get("owner/one", issue()); await cache.get("owner/two", issue());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenLastCalledWith("owner/one", 1);
  });
  it("does not cache failed or rate-limit-skipped relation fetches so subsequent calls retry (#319)", async () => {
    let mode: "fail" | "rate-limit" | "empty" = "fail";
    const relations: IssueRelations = { parent: { ...parent, repository: "owner/plans" }, progress: { total: 5, completed: 2 } };
    const fetch = vi.fn(async () => {
      if (mode === "fail") throw new Error("502 Bad Gateway");
      if (mode === "rate-limit") return null;
      return relations;
    });
    const cache = new IssueRelationsCache(fetch);
    // 1. Failed fetch rejects/throws -> resolves to null and is not cached
    expect(await cache.get("owner/repo", issue())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    // 2. Next get fetches again; rate-limit skipped returns null and is not cached
    mode = "rate-limit";
    expect(await cache.get("owner/repo", issue())).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);

    // 3. Next get fetches again; successful result is returned and cached
    mode = "empty";
    expect(await cache.get("owner/repo", issue())).toEqual(relations);
    expect(fetch).toHaveBeenCalledTimes(3);

    // 4. Subsequent get within TTL uses cache without fetching again
    expect(await cache.get("owner/repo", issue())).toEqual(relations);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("retries relations when client rate limit clears without caching skipped calls (#319)", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: { "retry-after": "60" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response({ parent, subIssuesSummary: { total: 3, completed: 1 } }))));
    vi.stubGlobal("fetch", fetch);
    const client = new GitHub("fictional-token");

    // First call hits 429 rate limit
    expect(await client.issueRelations("owner/repo", issue() as Issue)).toBeNull();
    expect(client.retryAfterMs()).toBeGreaterThan(0);

    // Second call while still rate-limited honours wait and does not make another HTTP request
    expect(await client.issueRelations("owner/repo", issue() as Issue)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    // Advance time past the rate limit wait
    vi.advanceTimersByTime(65_000);
    expect(client.retryAfterMs()).toBe(0);

    // Third call fetches again, succeeds, and caches for TTL
    const result = await client.issueRelations("owner/repo", issue() as Issue);
    expect(result?.parent?.number).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(2);

    // Fourth call uses cache
    expect(await client.issueRelations("owner/repo", issue() as Issue)).toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("limits relationship requests across repositories to three and releases slots after failures", async () => {
    let active = 0, maximum = 0;
    const pending: (() => void)[] = [];
    const cache = new IssueRelationsCache(async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => pending.push(resolve));
      active--;
      throw new Error("Unavailable");
    });
    const results = Array.from({ length: 9 }, (_, index) => cache.get(`owner/repo-${index}`, issue(index + 1)));
    for (let batch = 0; batch < 3; batch++) {
      expect(pending).toHaveLength(3);
      pending.splice(0).forEach(resolve => resolve());
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(await Promise.all(results)).toEqual(Array(9).fill(null));
    expect(maximum).toBe(3);
  });
  it("uses read-only authenticated GraphQL transport and quietly handles denied access", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(response({ parent, subIssuesSummary: { total: 5, completed: 2 } }))))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Resource not accessible by personal access token" }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const client = new GitHub("fictional-relations-token");
    expect((await client.issueRelations("owner/repo", issue() as Issue))?.progress).toEqual({ total: 5, completed: 2 });
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.github.com/graphql");
    expect(options.headers.Authorization).toBe("Bearer fictional-relations-token");
    expect(JSON.parse(options.body).variables).toEqual({ owner: "owner", name: "repo", number: 1 });
    expect(JSON.parse(options.body).query).toMatch(/^query IssueRelations/);
    expect(await client.issueRelations("owner/repo", issue(2) as Issue)).toBeNull();
  });
  it("computes progress immediately from REST sub_issues_summary and resolves parent from loader (#158)", async () => {
    const { useIssueRelations } = await import("../src/composables/useIssueRelations");
    const testIssue = ref<Issue>({
      id: 10, number: 10, title: "Parent task", state: "open", created_at: "2026-10-18T10:00:00Z",
      updated_at: "2026-10-18T10:00:00Z", closed_at: null, labels: [], assignees: [], comments: 0,
      html_url: "https://github.com/owner/repo/issues/10",
      sub_issues_summary: { total: 4, completed: 2 },
    });
    const isVisible = ref(true);
    const mockLoader = vi.fn(async () => ({
      parent: { id: "p1", number: 5, title: "Epic roadmap", state: "OPEN" as const, url: "https://github.com/owner/repo/issues/5", repository: "owner/repo" },
      progress: { total: 4, completed: 2 },
    }));

    const relations = useIssueRelations(
      () => testIssue.value,
      () => isVisible.value,
      () => mockLoader,
    );

    // REST progress is synchronous:
    expect(relations.progress.value).toEqual({ total: 4, completed: 2 });
    expect(relations.isSubtask.value).toBe(false);

    // Wait for loader to resolve:
    await vi.waitFor(() => expect(relations.isSubtask.value).toBe(true));
    expect(relations.parent.value?.title).toBe("Epic roadmap");
    expect(relations.parent.value?.number).toBe(5);

    // When sub_issues_summary is 0, progress is null:
    testIssue.value = { ...testIssue.value, sub_issues_summary: { total: 0, completed: 0 } };
    expect(relations.progress.value).toBeNull();
  });
  it("does not invoke loader in demo mode or when not visible (#158)", async () => {
    const { useIssueRelations } = await import("../src/composables/useIssueRelations");
    const testIssue = ref<Issue>({
      id: 11, number: 11, title: "Demo task", state: "open", created_at: "2026-10-18T10:00:00Z",
      updated_at: "2026-10-18T10:00:00Z", closed_at: null, labels: [], assignees: [], comments: 0,
      html_url: "https://github.com/owner/repo/issues/11",
    });
    const isVisible = ref(false);
    const isDemo = ref(true);
    const mockLoader = vi.fn(async () => null);

    useIssueRelations(
      () => testIssue.value,
      () => isVisible.value,
      () => mockLoader,
      undefined,
      undefined,
      () => isDemo.value,
    );

    expect(mockLoader).not.toHaveBeenCalled();
    isVisible.value = true;
    expect(mockLoader).not.toHaveBeenCalled();
    isDemo.value = false;
    // Now visible and not demo, should be called
    await vi.waitFor(() => expect(mockLoader).toHaveBeenCalled());
  });
});
