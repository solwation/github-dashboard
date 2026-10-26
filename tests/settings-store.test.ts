import { afterEach, expect, test, vi } from "vitest";
import { loadSettings, migrateLegacySettings, saveSettings, SettingsStorageError } from "../src/lib/settings-store";

afterEach(() => vi.unstubAllGlobals());

function createMockIndexedDB() {
  const data = new Map<string, any>();
  const db = {
    createObjectStore: () => {},
    close: () => {},
    transaction: () => {
      const tx: any = {
        objectStore: () => ({
          get: (key: string) => {
            const req: any = { result: data.get(key) };
            queueMicrotask(() => req.onsuccess?.({ target: req }));
            return req;
          },
          put: (val: any, key: string) => {
            data.set(key, val);
            const req: any = { result: key };
            queueMicrotask(() => req.onsuccess?.({ target: req }));
            return req;
          },
        }),
        oncomplete: null,
        onerror: null,
        onabort: null,
      };
      setTimeout(() => tx.oncomplete?.(), 5);
      return tx;
    },
  };
  const idb = {
    open: () => {
      const req: any = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => {
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      }, 5);
      return req;
    },
  };
  return { idb, data };
}

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

test("startup migration moves legacy plaintext settings to encrypted storage and preserves public-mode flag", async () => {
  const { idb, data } = createMockIndexedDB();
  const aliceSettings = { selected: ["org/repo-a"], rules: [] };
  const items = new Map<string, string>([
    ["issueflow:alice", JSON.stringify(aliceSettings)],
    ["issueflow:public-mode", "true"],
  ]);
  vi.stubGlobal("localStorage", {
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    removeItem: (key: string) => items.delete(key),
  });
  vi.stubGlobal("indexedDB", idb);

  await migrateLegacySettings();

  // Plaintext issueflow:alice must be removed from localStorage
  expect(items.has("issueflow:alice")).toBe(false);
  // issueflow:public-mode must be preserved untouched
  expect(items.get("issueflow:public-mode")).toBe("true");

  // An encrypted record exists for alice in IndexedDB
  expect(data.size).toBeGreaterThanOrEqual(2);
  // And loading alice's settings restores the original saved settings
  const restored = await loadSettings("alice");
  expect(restored).toEqual(aliceSettings);
});

test("startup migration swallows storage errors without blocking or removing legacy settings", async () => {
  const items = new Map([
    ["issueflow:bob", JSON.stringify({ selected: ["org/repo-b"] })],
    ["issueflow:public-mode", "true"],
  ]);
  vi.stubGlobal("localStorage", {
    get length() { return items.size; },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    removeItem: (key: string) => items.delete(key),
  });
  vi.stubGlobal("indexedDB", undefined);

  await expect(migrateLegacySettings()).resolves.toBeUndefined();
  expect(items.has("issueflow:bob")).toBe(true);
  expect(items.get("issueflow:public-mode")).toBe("true");
});
