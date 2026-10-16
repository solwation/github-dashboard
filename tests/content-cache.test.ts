import { beforeEach, describe, expect, it, vi } from "vitest";
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../src/lib/vault", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/vault")>(), loadContent: load, saveContent: save,
}));
import { MAX_CONTENT_BYTES } from "../src/lib/vault";
import { CONTENT_LIFETIME_MS, readSnapshot, writeSnapshot, type ContentSnapshot } from "../src/lib/content-cache";
const now = 1_800_000_000_000;
const valid = { version: 1, savedAt: now, syncedAt: now, user: { login: "fixture" }, repos: [], lanes: [], responses: [] };
beforeEach(() => { load.mockReset(); save.mockReset().mockResolvedValue(undefined); });
const snapshot = (): Omit<ContentSnapshot, "version" | "savedAt"> => ({
  syncedAt: now, user: { login: "fixture", avatar_url: "" }, repos: [], lanes: [], responses: [],
});
const response = (name: string, data: unknown): ContentSnapshot["responses"][number] =>
  [`https://api.github.com/${name}`, { etag: `"${name}"`, data, next: null }];
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
    const stored = save.mock.calls[0]![1] as ContentSnapshot;
    expect(stored.responses.map(([url]) => url)).toEqual(["https://api.github.com/new", "https://api.github.com/latest"]);
    expect({ ...stored, responses: [], savedAt: undefined, version: undefined }).toEqual({ ...input, responses: [], savedAt: undefined, version: undefined });
    expect(new TextEncoder().encode(JSON.stringify(stored)).byteLength).toBeLessThanOrEqual(MAX_CONTENT_BYTES);
    expect(input.responses).toHaveLength(4);
    load.mockResolvedValue(stored);
    expect(await readSnapshot("fixture")).toEqual(stored);
  });
  it("budgets UTF-8 bytes rather than JavaScript character counts", async () => {
    const input = snapshot();
    input.responses = [response("unicode", "å".repeat(3 * 1024 * 1024)), response("new", "x".repeat(3 * 1024 * 1024))];
    await writeSnapshot("fixture", input);
    expect(save.mock.calls[0]![1].responses).toEqual([input.responses[1]]);
  });
  it("keeps an oversized essential board complete for vault compression and propagates persistence failures", async () => {
    const input = { ...snapshot(), user: { login: "x".repeat(MAX_CONTENT_BYTES), avatar_url: "" }, responses: [response("optional", "value")] };
    await writeSnapshot("fixture", input);
    expect(save.mock.calls[0]![1].user).toEqual(input.user);
    expect(save.mock.calls[0]![1].responses).toEqual([]);
    const failure = new Error("Storage quota exceeded");
    save.mockRejectedValueOnce(failure);
    await expect(writeSnapshot("fixture", snapshot())).rejects.toBe(failure);
  });
  it("preserves only bounded validated timeout acknowledgements inside credential-bound content", async () => {
    const acknowledgement = { repo: "sample/repo", issueId: 1, startedAt: "2026-10-16T10:00:00.000Z" };
    load.mockResolvedValue({ ...valid, timeoutAcknowledgements: [acknowledgement, { issueId: "bad" }] });
    expect((await readSnapshot("fixture", now))?.timeoutAcknowledgements).toEqual([acknowledgement]);
    await writeSnapshot("fixture", { ...snapshot(), timeoutAcknowledgements: [acknowledgement] });
    expect(save.mock.calls[0]![0]).toBe("fixture");
    expect(save.mock.calls[0]![1].timeoutAcknowledgements).toEqual([acknowledgement]);
  });
  it("missing cache falls back to normal token sign-in", async () => {
    load.mockResolvedValue(null);
    expect(await readSnapshot("fixture", now)).toBeNull();
  });
});
