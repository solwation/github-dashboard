import { afterEach, expect, test, vi } from "vitest";
import { groupedLaneOrder, mergeExternalRepositories, parseExternalRepositories } from "../src/lib/external-repositories";
import { loadSettings, saveSettings } from "../src/lib/settings-store";
import { moveProject } from "../src/lib/project-layout";
import type { Repo } from "../src/lib/model";

afterEach(() => vi.unstubAllGlobals());

const repo = (full_name: string, id: number, extra: Partial<Repo> = {}) => ({
  id, name: full_name.split("/")[1], full_name, private: false, owner: { login: full_name.split("/")[0] },
  html_url: `https://github.com/${full_name}`, description: null, ...extra,
}) as Repo;

function mockIndexedDB() {
  const data = new Map<string, any>();
  const db = {
    createObjectStore: () => {}, close: () => {},
    transaction: () => {
      const tx: any = {
        objectStore: () => ({
          get: (key: string) => { const req: any = { result: data.get(key) }; queueMicrotask(() => req.onsuccess?.({ target: req })); return req; },
          put: (value: any, key: string) => { data.set(key, value); const req: any = { result: key }; queueMicrotask(() => req.onsuccess?.({ target: req })); return req; },
        }),
      };
      setTimeout(() => tx.oncomplete?.(), 1);
      return tx;
    },
  };
  return { data, idb: { open: () => { const req: any = { result: db }; setTimeout(() => { req.onupgradeneeded?.({ target: req }); req.onsuccess?.({ target: req }); }, 1); return req; } } };
}

test("external repositories and their order round-trip encrypted, separate from own order, and never reach web storage", async () => {
  const { idb, data } = mockIndexedDB();
  const local = new Map<string, string>(), session = new Map<string, string>();
  const storage = (items: Map<string, string>) => ({
    get length() { return items.size; }, key: (i: number) => [...items.keys()][i] ?? null,
    getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => items.delete(k),
  });
  vi.stubGlobal("indexedDB", idb); vi.stubGlobal("localStorage", storage(local)); vi.stubGlobal("sessionStorage", storage(session));
  const external = [repo("zed/zeta", 9), repo("alpha/alpha", 3)];
  await saveSettings("olw", { projectOrder: ["me/b", "me/a"], externalRepositories: external });
  const saved = await loadSettings("olw") as any;
  expect(saved.projectOrder).toEqual(["me/b", "me/a"]);
  expect(parseExternalRepositories(saved.externalRepositories, []).map(r => r.full_name)).toEqual(["zed/zeta", "alpha/alpha"]);
  expect(local.size + session.size).toBe(0);
  expect(JSON.stringify([...data.values()].map(entry => entry.ciphertext ? Array.from(new Uint8Array(entry.ciphertext)) : ""))).not.toContain("zeta");
  expect(await loadSettings("someone-else")).toBeNull();
});

test("parsing keeps only verified public, unique repositories that are not already own", () => {
  const own = [repo("me/mine", 1), repo("org/shared", 2)];
  const parsed = parseExternalRepositories([
    repo("org/shared", 2), repo("Other/Thing", 5), repo("other/thing", 5), repo("priv/repo", 6, { private: true }), { full_name: "bad" }, "x",
  ], own);
  expect(parsed.map(r => r.full_name)).toEqual(["Other/Thing"]);
  expect(parseExternalRepositories("nope", own)).toEqual([]);
});

test("merge puts own first and moves cached external copies into the external group", () => {
  const merged = mergeExternalRepositories([repo("x/y", 2), repo("me/a", 1)], [repo("x/y", 2), repo("o/z", 3)]);
  expect(merged.map(r => r.full_name)).toEqual(["me/a", "x/y", "o/z"]);
});

test("lane order keeps groups apart and each group's order independent", () => {
  const names = ["o/b", "me/a", "o/a", "me/b"];
  expect(groupedLaneOrder(["me/b", "me/a", "o/a"], ["o/b", "o/a"], names)).toEqual(["me/b", "me/a", "o/b", "o/a"]);
  const external = moveProject(["o/b", "o/a"], "o/a", "o/b");
  expect(groupedLaneOrder(["me/b", "me/a"], external, names)).toEqual(["me/b", "me/a", "o/a", "o/b"]);
});
