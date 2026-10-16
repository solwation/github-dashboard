import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import { IssueRelationsCache, parseIssueRelations, RELATIONS_TTL_MS, subIssueProgress } from "../src/lib/issue-relations";
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
    let complete!: (value: null) => void;
    const fetch = vi.fn(() => new Promise<null>(resolve => { complete = resolve; }));
    const cache = new IssueRelationsCache(fetch);
    const first = cache.get("owner/repo", issue());
    expect(cache.get("owner/repo", issue())).toBe(first);
    complete(null); await first;
    await cache.get("owner/repo", issue());
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RELATIONS_TTL_MS);
    const next = cache.get("owner/repo", issue()); complete(null); await next;
    expect(fetch).toHaveBeenCalledTimes(2);
    const changed = cache.get("owner/repo", { ...issue(), updated_at: "later" }); complete(null); await changed;
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.clear();
    const refreshed = cache.get("owner/repo", issue()); complete(null); await refreshed;
    expect(fetch).toHaveBeenCalledTimes(4);
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
});
