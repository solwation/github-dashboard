import { describe, expect, it, vi } from "vitest";
import { decidePublication, FALLBACK_AFTER_MS, fetchOpenQueue, inspectPublication, type GateInput, type GateTransport } from "../scripts/publication-gate.ts";

const base = "a".repeat(40), commit = "b".repeat(40), newer = "c".repeat(40);
const notes = [{ date: "2026-10-16", summary: { sv: "Kort.", en: "Short." }, sections: [{ text: { sv: "Bättre.", en: "Better." }, issues: [1, 2] }] }];
const delta = { baseCommit: base, summary: { sv: "Kort sammanfattning.", en: "Short update." }, issues: [1, 2] };
const issue = (number: number, labels: string[] = []) => ({ number, state: "open", labels: labels.map(name => ({ name })) });
const published = { build: { builtAt: "2026-10-16T10:00:00Z", commit: base }, days: notes };
const publishedAt = Date.parse(published.build.builtAt);
const artifact = { build: { builtAt: "2026-10-16T11:00:00Z", commit }, days: notes, delta };
const fixture = (overrides: Partial<GateInput> = {}): GateInput => ({
  runCommit: commit, mainCommit: commit, published, openIssues: [], sourceDelta: delta, sourceNotes: notes, now: publishedAt + 60 * 60 * 1000, ...overrides,
});

describe("Actions publication decision", () => {
  it("publishes ready work after three hours even while other issues are claimed, but never unready batch work (#144)", () => {
    const late = publishedAt + FALLBACK_AFTER_MS, early = late - 1;
    const active = [issue(3, ["in-progress", "orkester: session"]), issue(4, ["blocked"]), issue(1, ["needs-deploy"])];
    expect(decidePublication(fixture({ now: early, openIssues: active }))).toMatchObject({ allowed: false, reason: "queue-not-ready" });
    expect(decidePublication(fixture({ now: late, openIssues: active }))).toMatchObject({ allowed: true, reason: "ready-fallback" });
    expect(decidePublication(fixture({ now: late, openIssues: [issue(1, ["needs-deploy"])] }))).toMatchObject({ allowed: true, reason: "ready" });
    // Batch issues and ready work outside the batch keep their usual checks.
    expect(decidePublication(fixture({ now: late, openIssues: [issue(1, ["needs-deploy", "in-progress"])] })).reason).toBe("queue-not-ready");
    expect(decidePublication(fixture({ now: late, openIssues: [issue(2, ["in-progress"])] })).reason).toBe("queue-not-ready");
    expect(decidePublication(fixture({ now: late, openIssues: [issue(5, ["needs-deploy", "in-progress"])] })).reason).toBe("queue-not-ready");
    expect(decidePublication(fixture({ now: late, openIssues: [issue(5, ["needs-deploy"])] })).reason).toBe("ready-issue-missing-from-delta");
    // Without a readable build time there is no fallback, and already published code is still skipped.
    const unknownTime = { ...published, build: { ...published.build, builtAt: null } };
    expect(decidePublication(fixture({ now: late, published: unknownTime, openIssues: active })).reason).toBe("queue-not-ready");
    expect(decidePublication(fixture({ now: late, runCommit: base, mainCommit: base, openIssues: active })).reason).toBe("already-published");
  });
  it("allows a verified prepared delta with an empty queue or only unclaimed included needs-deploy work", () => {
    expect(decidePublication(fixture()).allowed).toBe(true);
    expect(decidePublication(fixture({ openIssues: [issue(1, ["needs-deploy"])] })).allowed).toBe(true);
    expect(decidePublication(fixture({ artifact })).allowed).toBe(true);
  });
  it("ignores unclaimed backlog issues outside the prepared delta", () => {
    expect(decidePublication(fixture({ openIssues: [issue(3), issue(4, ["priority: high", "enhancement"]), issue(1, ["needs-deploy"])] })).allowed).toBe(true);
    expect(decidePublication(fixture({ openIssues: [issue(3, ["in-progress"])] })).reason).toBe("queue-not-ready");
    expect(decidePublication(fixture({ openIssues: [issue(3, ["orkester: session"])] })).reason).toBe("queue-not-ready");
    expect(decidePublication(fixture({ openIssues: [issue(3, ["user question"]), issue(1, ["needs-deploy"])] })).allowed).toBe(true);
  });
  it.each([
    issue(1), issue(1, ["priority: high"]), issue(1, ["needs-deploy", "in-progress"]),
    issue(1, ["needs-deploy", "orkester: session"]), issue(1, ["needs-deploy", "owner: worker"]),
    issue(1, ["needs-deploy", "blocked"]), issue(1, ["needs-deploy", "status: blocked"]),
  ])("blocks included unfinished, active or owner-claimed issues even with readiness present: %j", item => {
    expect(decidePublication(fixture({ openIssues: [item] }))).toMatchObject({ allowed: false, reason: "queue-not-ready" });
  });
  it("ignores PRs and the exact coordination label, but never treats session owner prefixes as coordination", () => {
    expect(decidePublication(fixture({ openIssues: [{ ...issue(4), pull_request: {} }, issue(5, ["orkester", "in-progress"])] })).allowed).toBe(true);
    expect(decidePublication(fixture({ openIssues: [issue(5, ["orkester: session"])] })).allowed).toBe(false);
    expect(decidePublication(fixture({ openIssues: [issue(1, ["Orkester"])] })).allowed).toBe(false);
  });
  it("blocks ready work absent from this prepared delta and delta issues absent from daily notes", () => {
    expect(decidePublication(fixture({ openIssues: [issue(3, ["needs-deploy"])] })).reason).toBe("ready-issue-missing-from-delta");
    expect(decidePublication(fixture({ sourceDelta: { ...delta, issues: [3] } })).reason).toBe("delta-untraceable");
  });
  it.each([null, {}, { ...delta, summary: { sv: "a".repeat(181), en: "Short." } }, { ...delta, issues: [] }, { ...delta, issues: [1, 1] }])("blocks missing or malformed prepared metadata: %j", sourceDelta => {
    expect(decidePublication(fixture({ sourceDelta })).allowed).toBe(false);
  });
  it("binds the source delta to the actually published baseline and skips already published code", () => {
    expect(decidePublication(fixture({ sourceDelta: { ...delta, baseCommit: newer } })).reason).toBe("published-baseline-changed");
    expect(decidePublication(fixture({ published: null })).reason).toBe("published-baseline-invalid");
    expect(decidePublication(fixture({ published: { build: { commit: null, builtAt: null }, days: [] } })).allowed).toBe(false);
    expect(decidePublication(fixture({ runCommit: base, mainCommit: base, sourceDelta: null }))).toMatchObject({ allowed: false, reason: "already-published" });
  });
  it("rejects a run whose main advanced or whose source notes became invalid", () => {
    expect(decidePublication(fixture({ mainCommit: newer })).reason).toBe("main-advanced");
    expect(decidePublication(fixture({ sourceNotes: [{}] })).allowed).toBe(false);
    expect(decidePublication(fixture({ openIssues: [{ number: 4, labels: [] }] })).reason).toBe("metadata-invalid");
  });
  it.each([
    null, { ...artifact, build: { ...artifact.build, commit: newer } },
    { ...artifact, delta: { ...delta, summary: { sv: "Annan.", en: "Different." } } },
    { ...artifact, days: [] }, { ...artifact, delta: undefined },
  ])("rejects an artifact not matching the exact checked-out source and prepared delta: %j", result => {
    expect(decidePublication(fixture({ artifact: result }))).toMatchObject({ allowed: false, reason: "artifact-mismatch" });
  });
});

function transport(fetcher: typeof fetch): GateTransport {
  return { fetcher, api: "https://api.github.com", repository: "example/dashboard", token: "fictional-ci-token", publishedUrl: "https://example.github.io/dashboard/release-notes.json" };
}
describe("fresh paginated GitHub and public metadata", () => {
  it("reads every page beyond 100 issues", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const page = Number(new URL(String(url)).searchParams.get("page"));
      return Response.json(page === 1 ? Array.from({ length: 100 }, (_, i) => issue(i + 1)) : [issue(101)]);
    });
    expect(await fetchOpenQueue(transport(fetcher))).toHaveLength(101);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(String(fetcher.mock.calls[1]![0])).toContain("page=2");
  });
  it("checks the following page when the final nonempty page contains exactly 100 issues", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const page = Number(new URL(String(url)).searchParams.get("page"));
      return Response.json(page === 1 ? Array.from({ length: 100 }, (_, i) => issue(i + 1)) : []);
    });
    expect(await fetchOpenQueue(transport(fetcher))).toHaveLength(100);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("follows next-page indication even if a page has fewer than 100 rows", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const page = Number(new URL(String(url)).searchParams.get("page"));
      return Response.json([issue(page)], { headers: page === 1 ? { Link: '<https://api.github.com/next>; rel="next"' } : {} });
    });
    expect(await fetchOpenQueue(transport(fetcher))).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("fails closed when an issue disappears during pagination causing page 2 to shift", async () => {
    let removed = false;
    const fetcher = vi.fn(async (value: string | URL | Request) => {
      const url = new URL(String(value));
      if (url.pathname.endsWith("/commits/main")) return Response.json({ sha: commit });
      if (url.pathname.endsWith("/release-notes.json")) return Response.json(published);
      const page = Number(url.searchParams.get("page"));
      if (page === 1) {
        if (!removed) {
          removed = true;
          return Response.json(Array.from({ length: 100 }, (_, i) => issue(i + 1)));
        }
        return Response.json([...Array.from({ length: 49 }, (_, i) => issue(i + 1)), ...Array.from({ length: 51 }, (_, i) => issue(i + 51))]);
      }
      return Response.json([]);
    });
    await expect(fetchOpenQueue(transport(fetcher))).rejects.toThrow("Inconsistent issue pagination");
    removed = false;
    expect(await inspectPublication(transport(fetcher), fixture())).toMatchObject({ allowed: false, reason: "metadata-unavailable" });
  });
  it("fails closed on later pagination errors and inconsistent or invalid issue data", async () => {
    let count = 0;
    await expect(fetchOpenQueue(transport(vi.fn(async () => ++count === 1
      ? Response.json(Array.from({ length: 100 }, (_, i) => issue(i + 1)))
      : new Response("", { status: 503 }))))).rejects.toThrow();
    await expect(fetchOpenQueue(transport(vi.fn(async () => Response.json({ message: "unavailable" }))))).rejects.toThrow();
    const repeated = vi.fn(async () => Response.json([issue(1), issue(1)]));
    await expect(fetchOpenQueue(transport(repeated))).rejects.toThrow();
  });
  it("keeps the CI token on GitHub API requests only and enforces request timeouts", async () => {
    const fetcher = vi.fn(async (value: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(value));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      if (url.host === "api.github.com") {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fictional-ci-token");
        return Response.json(url.pathname.endsWith("/commits/main") ? { sha: commit } : []);
      }
      expect(new Headers(init?.headers).has("Authorization")).toBe(false);
      expect(url.pathname).toBe("/dashboard/release-notes.json");
      return Response.json(published);
    });
    expect((await inspectPublication(transport(fetcher), fixture())).allowed).toBe(true);
  });
  it("refreshes queue, public baseline and remote main before final deployment instead of trusting the initial pass", async () => {
    let queue: unknown[] = [], liveMain = commit, baseline = published;
    const fetcher = vi.fn(async (value: string | URL | Request) => {
      const url = new URL(String(value));
      return Response.json(url.host !== "api.github.com" ? baseline : url.pathname.endsWith("/commits/main") ? { sha: liveMain } : queue);
    });
    const api = transport(fetcher);
    expect((await inspectPublication(api, fixture())).allowed).toBe(true);
    queue = [issue(3, ["in-progress"])];
    expect((await inspectPublication(api, fixture({ artifact }))).reason).toBe("queue-not-ready");
    queue = [];
    liveMain = newer;
    expect((await inspectPublication(api, fixture({ artifact }))).reason).toBe("main-advanced");
    liveMain = commit;
    baseline = { ...published, build: { ...published.build, commit: newer } };
    expect((await inspectPublication(api, fixture({ artifact }))).reason).toBe("published-baseline-changed");
  });
  it("returns a safe blocked result on API/public-manifest failure without logging error contents", async () => {
    const bad = vi.fn(async () => { throw new Error("private response must never be logged"); });
    expect(await inspectPublication(transport(bad), fixture())).toMatchObject({ allowed: false, reason: "metadata-unavailable" });
  });
});
