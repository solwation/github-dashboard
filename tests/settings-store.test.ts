import { afterEach, expect, test, vi } from "vitest";
import { loadSettings, saveSettings, SettingsStorageError } from "../src/lib/settings-store";

afterEach(() => vi.unstubAllGlobals());

test("unavailable storage rejects without discarding legacy plaintext settings", async () => {
  const items = new Map([["issueflow:fixture", JSON.stringify({ selected: ["sample/alpha"] })]]);
  vi.stubGlobal("localStorage", {
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    removeItem: (key: string) => items.delete(key),
  });
  vi.stubGlobal("indexedDB", undefined);
  await expect(loadSettings("fixture")).rejects.toBeInstanceOf(SettingsStorageError);
  expect(items.has("issueflow:fixture")).toBe(true);
  await expect(saveSettings("fixture", { selected: [] })).rejects.toBeInstanceOf(SettingsStorageError);
});
