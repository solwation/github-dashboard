import { beforeEach, describe, expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/vault", () => ({ loadContent: load, saveContent: vi.fn() }));
import { CONTENT_LIFETIME_MS, readSnapshot } from "../src/lib/content-cache";
const now = 1_800_000_000_000;
const valid = { version: 1, savedAt: now, syncedAt: now, user: { login: "fixture" }, repos: [], lanes: [], responses: [] };
beforeEach(() => load.mockReset());
describe("bounded content snapshot", () => {
  it("accepts valid recent snapshots and rejects old, future and incompatible content", async () => {
    load.mockResolvedValue(valid); expect(await readSnapshot("fixture", now)).toEqual(valid);
    for (const data of [{ ...valid, savedAt: now - CONTENT_LIFETIME_MS }, { ...valid, savedAt: now + 1 }, { ...valid, version: 2 }, { ...valid, lanes: [{ issues: [] }] }, { ...valid, user: null }]) {
      load.mockResolvedValue(data); expect(await readSnapshot("fixture", now)).toBeNull();
    }
  });
  it("missing cache falls back to normal token sign-in", async () => {
    load.mockResolvedValue(null);
    expect(await readSnapshot("fixture", now)).toBeNull();
  });
});
