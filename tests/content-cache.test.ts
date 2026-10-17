import { beforeEach, describe, expect, it, vi } from "vitest";
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../src/lib/vault", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/vault")>(), loadContent: load, saveEncodedContent: save,
}));
import { MAX_CONTENT_BYTES } from "../src/lib/vault";
import { CONTENT_LIFETIME_MS, readSnapshot, writeSnapshot, type ContentSnapshot } from "../src/lib/content-cache";
import type { Issue, Lane } from "../src/lib/model";
const now = 1_800_000_000_000;
const valid = { version: 1, savedAt: now, syncedAt: now, user: { login: "fixture" }, repos: [], lanes: [], responses: [] };
beforeEach(() => { load.mockReset(); save.mockReset().mockResolvedValue(undefined); });
const snapshot = (): Omit<ContentSnapshot, "version" | "savedAt"> => ({
  syncedAt: now, user: { login: "fixture", avatar_url: "" }, repos: [], lanes: [], responses: [],
});
const response = (name: string, data: unknown): ContentSnapshot["responses"][number] =>
  [`https://api.github.com/${name}`, { etag: `"${name}"`, data, next: null }];
/** The vault receives already serialized UTF-8 JSON bytes. */
const saved = (call = 0) => JSON.parse(new TextDecoder().decode(save.mock.calls[call]![1] as Uint8Array)) as ContentSnapshot;
describe("bounded content snapshot", () => {
  it("accepts valid recent snapshots and rejects old, future and incompatible content", async () => {
    load.mockResolvedValue(valid); expect(await readSnapshot("fixture", now)).toEqual(valid);
    for (const data of [{ ...valid, savedAt: now - CONTENT_LIFETIME_MS }, { ...valid, savedAt: now + 1 }, { ...valid, version: 2 }, { ...valid, lanes: [{ issues: [] }] }, { ...valid, user: null }]) {
      load.mockResolvedValue(data); expect(await readSnapshot("fixture", now)).toBeNull();
    }
  });
  it("keeps the complete board and newest fitting responses when optional API data exceeds the budget", async () => {
    const input = snapshot();
    input.responses = [response("old", "x".repeat(5 * 1024 * 1024)), response("oversized", "x".repeat(MAX_CONTENT_BYTES)), response("new", "x".repeat(4 * 1024 * 1024)), response("latest", { fixture: true })];
    await writeSnapshot("fixture", input);
    const stored = saved();
    expect(stored.responses.map(([url]) => url)).toEqual(["https://api.github.com/new", "https://api.github.com/latest"]);
    expect({ ...stored, responses: [], savedAt: undefined, version: undefined }).toEqual({ ...input, responses: [], savedAt: undefined, version: undefined });
    expect((save.mock.calls[0]![1] as Uint8Array).byteLength).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(stored)).byteLength).toBe((save.mock.calls[0]![1] as Uint8Array).byteLength);
    expect(input.responses).toHaveLength(4);
    load.mockResolvedValue(stored);
    expect(await readSnapshot("fixture")).toEqual(stored);
  });
  it("budgets UTF-8 bytes rather than JavaScript character counts", async () => {
    const input = snapshot();
    input.responses = [response("unicode", "å".repeat(3 * 1024 * 1024)), response("new", "x".repeat(3 * 1024 * 1024))];
    await writeSnapshot("fixture", input);
    expect(saved().responses).toEqual([input.responses[1]]);
  });
  it("keeps an oversized essential board complete for vault compression and propagates persistence failures", async () => {
    const input = { ...snapshot(), user: { login: "x".repeat(MAX_CONTENT_BYTES), avatar_url: "" }, responses: [response("optional", "value")] };
    await writeSnapshot("fixture", input);
    expect(saved().user).toEqual(input.user);
    expect(saved().responses).toEqual([]);
    const failure = new Error("Storage quota exceeded");
    save.mockRejectedValueOnce(failure);
    await expect(writeSnapshot("fixture", snapshot())).rejects.toBe(failure);
  });
  it("restores snapshots with legacy timeout acknowledgements and no longer stores them", async () => {
    const acknowledgement = { repo: "sample/repo", issueId: 1, startedAt: "2026-10-16T10:00:00.000Z" };
    load.mockResolvedValue({ ...valid, timeoutAcknowledgements: [acknowledgement, { issueId: "bad" }] });
    const restored = await readSnapshot("fixture", now);
    expect(restored).not.toBeNull();
    expect(restored).not.toHaveProperty("timeoutAcknowledgements");
    await writeSnapshot("fixture", snapshot());
    expect(saved()).not.toHaveProperty("timeoutAcknowledgements");
  });
  it("missing cache falls back to normal token sign-in", async () => {
    load.mockResolvedValue(null);
    expect(await readSnapshot("fixture", now)).toBeNull();
  });
});

const github = "https://api.github.com";
const user = (login: string) => ({ login, id: 1000, node_id: "MDQ6VXNlcjEwMDA=", avatar_url: `https://avatars.githubusercontent.com/u/1000?v=4`, gravatar_id: "",
  url: `${github}/users/${login}`, html_url: `https://github.com/${login}`, followers_url: `${github}/users/${login}/followers`, following_url: `${github}/users/${login}/following{/other_user}`,
  gists_url: `${github}/users/${login}/gists{/gist_id}`, starred_url: `${github}/users/${login}/starred{/owner}{/repo}`, subscriptions_url: `${github}/users/${login}/subscriptions`,
  organizations_url: `${github}/users/${login}/orgs`, repos_url: `${github}/users/${login}/repos`, events_url: `${github}/users/${login}/events{/privacy}`,
  received_events_url: `${github}/users/${login}/received_events`, type: "User", user_view_type: "public", site_admin: false });
const label = (repo: string, name: string) => ({ id: name.length, node_id: "LA_kwDO", url: `${github}/repos/${repo}/labels/${name}`, name, color: "ededed", default: false, description: `${name} work` });
/** A GitHub REST issue in the shape the issues endpoint returns. */
function rawIssue(repo: string, id: number, extra: Record<string, unknown> = {}) {
  const number = id % 1000, base = `${github}/repos/${repo}/issues/${number}`;
  return { url: base, repository_url: `${github}/repos/${repo}`, labels_url: `${base}/labels{/name}`, comments_url: `${base}/comments`, events_url: `${base}/events`,
    html_url: `https://github.com/${repo}/issues/${number}`, id, node_id: `I_kwDO${id}`, number, title: `Fixture issue ${id} with a realistic title length`,
    user: user("fixture-author"), labels: [label(repo, "bug"), label(repo, "priority: medium")], state: "open", locked: false, assignee: null,
    assignees: [], milestone: null, comments: 3, created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-16T10:00:00Z", closed_at: null,
    author_association: "MEMBER", type: null, active_lock_reason: null, sub_issues_summary: { total: 0, completed: 0, percent_completed: 0 },
    issue_dependencies_summary: { blocked_by: 0, total_blocked_by: 0, blocking: 0, total_blocking: 0 },
    body: "Fixture description with acceptance criteria. ".repeat(4), closed_by: null,
    reactions: { url: `${base}/reactions`, total_count: 0, "+1": 0, "-1": 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
    timeline_url: `${base}/timeline`, performed_via_github_app: null, state_reason: null, ...extra } as unknown as Issue;
}
const listUrl = (repo: string, state: string) => `${github}/repos/${repo}/issues?state=${state}&per_page=100&sort=created&direction=asc`;
const etagged = (url: string, data: unknown, next: string | null = null): ContentSnapshot["responses"][number] => [url, { etag: `W/"${url.length}"`, data, next }];

describe("issue-list responses are stored once, in lanes (#122)", () => {
  function board(repos: number, issues: number) {
    const lanes: Lane[] = [], responses: ContentSnapshot["responses"] = [];
    for (let r = 0; r < repos; r++) {
      const name = `sample/repo-${r}`;
      const raw = Array.from({ length: issues }, (_, i) => rawIssue(name, r * 1000 + i + 1));
      const labels = [label(name, "bug"), label(name, "priority: medium")];
      // Lane issues are copies of the raw list items, as GitHub.lane() makes them.
      lanes.push({ repo: { id: r, name: `repo-${r}`, full_name: name, description: null, private: true, html_url: `https://github.com/${name}`, owner: { login: "sample" } },
        issues: raw.map(issue => ({ ...issue })), labels });
      responses.push(etagged(listUrl(name, "open"), raw), etagged(listUrl(name, "closed"), []), etagged(`${github}/repos/${name}/labels?per_page=100`, labels));
    }
    return { ...snapshot(), lanes, responses };
  }
  it("shrinks a 12 repository × 70 issue snapshot by at least 40% and restores identical ETag responses", async () => {
    const input = board(12, 70);
    const before = new TextEncoder().encode(JSON.stringify({ ...input, version: 1, savedAt: now })).byteLength;
    await writeSnapshot("fixture", input);
    const after = (save.mock.calls[0]![1] as Uint8Array).byteLength;
    console.info(`12×70 snapshot: ${before} → ${after} bytes (${Math.round(100 - after / before * 100)}% smaller)`);
    expect(after).toBeLessThanOrEqual(before * 0.6);
    load.mockResolvedValue(saved());
    const restored = await readSnapshot("fixture");
    expect(restored!.lanes).toEqual(input.lanes);
    expect(restored!.responses).toEqual(input.responses);
  });
  it("leaves out pull requests and local timer fields, and keeps raw bodies the board cannot rebuild", async () => {
    const input = snapshot();
    const issue = rawIssue("sample/test", 1), pull = rawIssue("sample/test", 2, { pull_request: { url: "x" } }), outside = rawIssue("sample/test", 3, { state: "closed" });
    input.lanes = [{ repo: { id: 1, name: "test", full_name: "sample/test", description: null, private: true, html_url: "", owner: { login: "sample" } },
      issues: [{ ...issue, startedAt: "2026-10-16T09:00:00Z", timerError: false, workStartedAt: "2026-10-16T08:00:00Z" }], labels: [] }];
    input.responses = [etagged(listUrl("sample/test", "open"), [pull, issue], `${github}/next`), etagged(listUrl("sample/test", "closed"), [outside]),
      etagged(`${github}/repos/sample/test/issues/1/events?per_page=100`, [{ id: 9, event: "labeled" }])];
    await writeSnapshot("fixture", input);
    const stored = saved();
    expect(stored.responses[0]).toEqual([listUrl("sample/test", "open"), { etag: input.responses[0]![1].etag, next: `${github}/next`, issues: [1] }]);
    expect(stored.responses.slice(1)).toEqual(input.responses.slice(1));
    load.mockResolvedValue(stored);
    const restored = await readSnapshot("fixture");
    expect(restored!.responses[0]).toEqual([listUrl("sample/test", "open"), { etag: input.responses[0]![1].etag, next: `${github}/next`, data: [issue] }]);
    // The closing work start (#141) survives in the restored lanes but not in rebuilt raw responses.
    expect(restored!.lanes[0]!.issues[0]!.workStartedAt).toBe("2026-10-16T08:00:00Z");
    expect(restored!.responses.slice(1)).toEqual(input.responses.slice(1));
  });
  it("drops stored lists whose issues are missing, so they are downloaded again instead of answered from 304", async () => {
    load.mockResolvedValue({ ...valid, responses: [[listUrl("sample/test", "open"), { etag: '"x"', next: null, issues: [5] }],
      ["https://example.com/repos/a/b/issues", { etag: '"y"', next: null, issues: [] }], [listUrl("sample/test", "closed"), { etag: '"z"', next: null, issues: [] }]] });
    expect((await readSnapshot("fixture", now))!.responses).toEqual([[listUrl("sample/test", "closed"), { etag: '"z"', next: null, data: [] }]]);
  });
  it("serializes the board and each response exactly once per write", async () => {
    const input = board(2, 3);
    const stringify = vi.spyOn(JSON, "stringify");
    let calls: unknown[][];
    try { await writeSnapshot("fixture", input); } finally { calls = [...stringify.mock.calls]; stringify.mockRestore(); }
    expect(calls).toHaveLength(1 + input.responses.length);
    expect(calls.filter(([value]) => (value as { lanes?: unknown }).lanes === input.lanes)).toHaveLength(1);
  });
});
