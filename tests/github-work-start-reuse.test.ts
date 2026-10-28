import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHub } from "../src/lib/github";
import type { Issue, Repo } from "../src/lib/model";
const now = Date.now(), iso = (offset: number) => new Date(now + offset).toISOString();
const repo: Repo = { id: 1, name: "test", full_name: "sample/test", html_url: "https://github.com/sample/test", private: true, description: null, owner: { login: "sample" } };
const work = (): Issue => ({ id: 1, number: 1, title: "Fictional work", html_url: repo.html_url + "/issues/1", state: "open", created_at: iso(-86400000), updated_at: iso(-60000), closed_at: null, labels: [{ name: "in-progress", color: "aaa" }], assignees: [] });
function fixture() {
  const state = { issues: [work()], events: [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: iso(-1500000) }], fail: false, timelineCalls: 0, listCalls: 0, conditionalLists: 0 };
  vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => {
    const timeline = /\/issues\/\d+\/events$/.test(url.pathname);
    if (timeline) { state.timelineCalls++; if (state.fail) return new Response("{}", { status: 500 }); }
    else state.listCalls++;
    const body = timeline ? state.events : url.pathname.endsWith("/labels") ? [{ name: "in-progress", color: "aaa" }]
      : state.issues.filter(issue => url.searchParams.get("state") === "all" || issue.state === url.searchParams.get("state"));
    const json = JSON.stringify(body), etag = `"${encodeURIComponent(json)}"`;
    if ((init.headers as Record<string, string>)["If-None-Match"] === etag) { if (!timeline) state.conditionalLists++; return new Response(null, { status: 304 }); }
    return new Response(json, { headers: { etag } });
  }));
  return state;
}
afterEach(() => vi.unstubAllGlobals());
describe("authenticated full-refresh work-start reuse", () => {
  it("revalidates all issue/label lists while carrying current-client unchanged starts without timeline reads", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    let lane = await api.lane(repo, {});
    const before = lane.issues[0];
    lane = await api.lane(repo, {}, lane);
    lane = await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(1);
    expect(state.listCalls).toBe(9);
    expect(state.conditionalLists).toBe(6);
    expect(lane.issues[0]?.startedAt).toBe(iso(-1500000));
    expect(lane.issues[0]?.timerError).toBe(false);
    expect(lane.timerWarning).toBe(false);
    expect(lane.issues[0]).not.toBe(before);
    const raw = JSON.stringify(api.exportResponses());
    expect(raw).not.toContain("startedAt"); expect(raw).not.toContain("timerError");
  });
  it.each([
    ["updated timestamp", (issue: Issue) => { issue.updated_at = iso(0); }],
    ["work labels even if timestamp is unchanged", (issue: Issue) => { issue.labels.push({ name: "working", color: "aaa" }); }],
    ["reopened state even if timestamp is unchanged", (issue: Issue) => { issue.closed_at = iso(-1000); }],
    ["issue identity", (issue: Issue) => { issue.id = 2; }],
  ] as const)("refreshes history for changed %s", async (_name, change) => {
    const state = fixture(), api = new GitHub("fixture-token");
    const lane = await api.lane(repo, {});
    change(state.issues[0]!);
    state.events = [{ id: 2, event: "labeled", label: { name: "in-progress" }, created_at: iso(-300000) }];
    const next = await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(2);
    expect(next.issues[0]?.startedAt).toBe(iso(-300000));
    expect(lane.issues[0]?.startedAt).toBe(iso(-1500000));
  });
  it("drops an old interval when work stops and reads fresh history when the label returns", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    let lane = await api.lane(repo, {});
    state.issues[0]!.labels = [];
    lane = await api.lane(repo, {}, lane);
    expect(lane.issues[0]?.startedAt).toBeUndefined();
    expect(state.timelineCalls).toBe(1);
    state.issues[0]!.labels = [{ name: "in-progress", color: "aaa" }];
    state.events = [{ id: 2, event: "labeled", label: { name: "in-progress" }, created_at: iso(-300000) }];
    lane = await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(2);
    expect(lane.issues[0]?.startedAt).toBe(iso(-300000));
  });
  it("does not trust unchanged malformed update timestamps", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    state.issues[0]!.updated_at = "not-a-date";
    const lane = await api.lane(repo, {});
    await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(2);
  });
  it("invalidates changed work-rule interpretation but not unrelated priority rules; sync/full share evidence", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    state.issues[0]!.labels.push({ name: "Building", color: "aaa" });
    state.events.push({ id: 2, event: "labeled", label: { name: "Building" }, created_at: iso(-300000) });
    let lane = await api.lane(repo, {});
    lane = await api.lane(repo, { high: "P1" }, lane);
    expect(state.timelineCalls).toBe(1);
    lane = await api.lane(repo, { progress: "building" }, lane);
    expect(state.timelineCalls).toBe(2);
    expect(lane.issues[0]?.startedAt).toBe(iso(-300000));
    lane = await api.syncLane(lane, { progress: "building" }, now, { labels: false });
    lane = await api.lane(repo, { progress: "building" }, lane);
    expect(state.timelineCalls).toBe(2);
    lane = await api.syncLane(lane, {}, now, { labels: false });
    expect(state.timelineCalls).toBe(3);
    expect(lane.issues[0]?.startedAt).toBe(iso(-1500000));
  });
  it("does not reuse across clients/accounts, repositories or cloned restored objects", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    const lane = await api.lane(repo, {});
    await new GitHub("other-token").lane(repo, {}, lane);
    await api.lane({ ...repo, id: 2, full_name: "sample/other" }, {}, lane);
    await api.lane(repo, {}, structuredClone(lane));
    expect(state.timelineCalls).toBe(4);
  });
  it("keeps unavailable history retryable and does not mistake unknown/error starts for valid evidence", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    state.fail = true;
    let lane = await api.lane(repo, {});
    expect(lane.timerWarning).toBe(true);
    state.fail = false; state.events = [];
    lane = await api.lane(repo, {}, lane);
    expect(lane.timerWarning).toBe(false); expect(lane.issues[0]?.startedAt).toBeNull();
    state.events = [{ id: 1, event: "labeled", label: { name: "in-progress" }, created_at: iso(-1500000) }];
    lane = await api.lane(repo, {}, lane);
    lane.issues[0]!.timerError = true;
    lane = await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(4);
    expect(lane.issues[0]?.startedAt).toBe(iso(-1500000));
  });
  it("does not trust tampered or future timestamps", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    let lane = await api.lane(repo, {});
    lane.issues[0]!.startedAt = iso(-1000);
    lane = await api.lane(repo, {}, lane);
    state.events[0]!.created_at = iso(86400000);
    state.issues[0]!.updated_at = iso(0);
    lane = await api.lane(repo, {}, lane);
    await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(4);
  });
  it("preserves closing work-start carry and refreshes a reopened issue rather than carrying a closed interval", async () => {
    const state = fixture(), api = new GitHub("fixture-token");
    let lane = await api.lane(repo, {});
    state.issues[0] = { ...state.issues[0]!, state: "closed", closed_at: iso(-1000), updated_at: iso(-1000) };
    lane = await api.lane(repo, {}, lane);
    expect(lane.issues[0]?.workStartedAt).toBe(iso(-1500000));
    expect(state.timelineCalls).toBe(1);
    state.issues[0] = { ...state.issues[0]!, state: "open", closed_at: null, updated_at: iso(0) };
    state.events = [{ id: 2, event: "reopened", label: { name: "in-progress" }, created_at: iso(-500) }, { id: 3, event: "labeled", label: { name: "in-progress" }, created_at: iso(-400) }];
    lane = await api.lane(repo, {}, lane);
    expect(state.timelineCalls).toBe(2);
    expect(lane.issues[0]?.startedAt).toBe(iso(-400));
  });
  it("preserves the public bounded-history lane and unchanged incremental behavior", async () => {
    const state = fixture(), api = new GitHub();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: URL, init: RequestInit) => url.pathname.endsWith("/issues/events")
      ? new Response(JSON.stringify(state.events.map(event => ({ ...event, issue: state.issues[0] })))) : originalFetch(url, init)));
    let lane = await api.lane(repo, {});
    lane = await api.syncLane(lane, {}, now, { labels: false });
    expect(lane.issues[0]?.startedAt).toBe(iso(-1500000));
    expect(state.timelineCalls).toBe(0);
  });
});
