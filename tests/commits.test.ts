import { afterEach, expect, test, vi } from "vitest";
import { ClosingCommitCache, parseClosingCommit, type ClosingResponse } from "../src/lib/commits";
import { GitHub } from "../src/lib/github";
import type { Issue } from "../src/lib/model";

const closedAt = "2026-10-15T13:00:00Z";
const issue: Issue = {
  id: 1, number: 2, title: "Fixture", html_url: "https://github.com/owner/repo/issues/2",
  state: "closed", created_at: "2026-01-01", updated_at: closedAt, closed_at: closedAt,
  labels: [], assignees: [],
};
const closer = { __typename: "Commit" as const, oid: "abcdef123456789", url: "https://github.com/owner/repo/commit/abcdef123456789", additions: 21, deletions: 3 };
function response(value: typeof closer | Record<string, unknown> | null = closer): ClosingResponse {
  return { data: { repository: { issue: {
    state: "CLOSED", closedAt,
    timelineItems: { nodes: [{ createdAt: closedAt, closer: value as typeof closer }] },
  } } } };
}
afterEach(() => vi.unstubAllGlobals());

test("direct closing commit exposes exact SHA, link and line totals", () => {
  expect(parseClosingCommit(response(), issue)).toEqual({
    kind: "commit", sha: closer.oid, url: closer.url, additions: 21, deletions: 3,
  });
});
test("explicit merged PR closer exposes PR link, merge SHA and PR totals", () => {
  expect(parseClosingCommit(response({
    __typename: "PullRequest", number: 9, url: "https://github.com/owner/repo/pull/9", merged: true,
    additions: 56, deletions: 8, mergeCommit: { oid: "123456789abcdef" },
  }), issue)).toEqual({
    kind: "pull-request", pullRequestNumber: 9, url: "https://github.com/owner/repo/pull/9",
    sha: "123456789abcdef", additions: 56, deletions: 8,
  });
});
test("PR without merge SHA keeps its authoritative link and zero line counts", () => {
  expect(parseClosingCommit(response({
    __typename: "PullRequest", number: 9, url: "https://github.com/owner/repo/pull/9", merged: true,
    additions: 0, deletions: 0, mergeCommit: null,
  }), issue)).toMatchObject({ sha: null, additions: 0, deletions: 0 });
});
test("manual closure has no association; unrelated or old closures cannot leak through", () => {
  expect(parseClosingCommit(response(null), issue)).toBeNull();
  const old = response();
  old.data!.repository!.issue!.timelineItems.nodes[0]!.createdAt = "2026-01-01T12:00:00Z";
  expect(parseClosingCommit(old, issue)).toBeNull();
  expect(parseClosingCommit(response(), { ...issue, closed_at: "2026-10-15T14:00:00Z" })).toBeNull();
  expect(parseClosingCommit(response(), { ...issue, state: "open" })).toBeNull();
  expect(parseClosingCommit(response({ __typename: "PullRequest", merged: false }), issue)).toBeNull();
});
test("partial GraphQL errors and inaccessible issues are failures, not missing associations", () => {
  expect(() => parseClosingCommit({ ...response(null), errors: [{ message: "Insufficient scope" }] }, issue)).toThrow();
  expect(() => parseClosingCommit({ data: { repository: null } }, issue)).toThrow();
  expect(() => parseClosingCommit(response({ ...closer, url: "https://example.com/commit" }), issue)).toThrow();
});

test("cache deduplicates per repo, issue and exact closure and does not retain failures", async () => {
  const fetch = vi.fn().mockResolvedValue(null);
  const cache = new ClosingCommitCache(fetch);
  await Promise.all([cache.get("owner/repo", issue), cache.get("owner/repo", issue)]);
  expect(fetch).toHaveBeenCalledTimes(1);
  await cache.get("owner/other", issue);
  await cache.get("owner/repo", { ...issue, closed_at: "2026-10-16T00:00:00Z" });
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch.mockRejectedValueOnce(new Error("offline"));
  const changed = { ...issue, number: 99 };
  await expect(cache.get("owner/repo", changed)).rejects.toThrow("offline");
  await expect(cache.get("owner/repo", changed)).resolves.toBeNull();
  expect(fetch).toHaveBeenCalledTimes(5);
});
test("cache caps simultaneous metadata fetches at three and evicts old entries", async () => {
  let active = 0, maximum = 0;
  const fetch = vi.fn(async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return null;
  });
  const cache = new ClosingCommitCache(fetch);
  await Promise.all(Array.from({ length: 305 }, (_, number) => cache.get("owner/repo", { ...issue, number })));
  expect(maximum).toBe(3);
  await cache.get("owner/repo", { ...issue, number: 0 });
  expect(fetch).toHaveBeenCalledTimes(306);
});
test("transport sends authenticated GraphQL query and variables, reuses result per instance", async () => {
  const mock = vi.fn(async () => new Response(JSON.stringify(response())));
  vi.stubGlobal("fetch", mock);
  const api = new GitHub("fixture-token");
  await api.closingCommit("owner/repo", issue);
  await api.closingCommit("owner/repo", issue);
  expect(mock).toHaveBeenCalledTimes(1);
  const [url, options] = mock.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe("https://api.github.com/graphql");
  expect(options.method).toBe("POST");
  expect(options.headers).toMatchObject({ Authorization: "Bearer fixture-token" });
  expect(JSON.parse(options.body as string).variables).toEqual({ owner: "owner", name: "repo", number: 2 });
  await new GitHub("other-token").closingCommit("owner/repo", issue);
  expect(mock).toHaveBeenCalledTimes(2);
});
test("HTTP failure rejects metadata without poisoning future retries", async () => {
  const mock = vi.fn()
    .mockResolvedValueOnce(new Response("{}", { status: 403 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(response(null))));
  vi.stubGlobal("fetch", mock);
  const api = new GitHub("fixture-token");
  await expect(api.closingCommit("owner/repo", issue)).rejects.toThrow();
  await expect(api.closingCommit("owner/repo", issue)).resolves.toBeNull();
});
