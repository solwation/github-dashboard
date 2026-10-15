import { expect, test, type Page } from "@playwright/test";

// Import the actual module through Vite to exercise native IndexedDB and WebCrypto.
async function vault(page: Page, action: "save" | "load" | "clear", token = "") {
  return page.evaluate(async ({ action, token }) => {
    const modulePath = "/src/lib/vault.ts";
    const api = await import(/* @vite-ignore */ modulePath);
    if (action === "save") return api.saveToken(token);
    if (action === "clear") return api.clearToken();
    return api.loadToken();
  }, { action, token });
}

async function recordInfo(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("issueflow-vault", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const record = await new Promise<any>((resolve, reject) => {
        const request = db.transaction("credentials").objectStore("credentials").get("github");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return record ? {
        fields: Object.keys(record).sort(),
        keyExtractable: record.key.extractable,
        algorithm: record.key.algorithm.name,
        iv: Array.from(record.iv),
        ciphertext: Array.from(new Uint8Array(record.ciphertext)),
        storedText: new TextDecoder().decode(record.ciphertext),
      } : null;
    } finally { db.close(); }
  });
}

test("encrypted PAT survives a cache-bypassing reload and leaves no plaintext storage", async ({ page }) => {
  await page.goto("/");
  const token = "test-only-pat-for-encrypted-storage";
  await vault(page, "save", token);
  const record = await recordInfo(page);
  expect(record).toMatchObject({ fields: ["ciphertext", "iv", "key"], keyExtractable: false, algorithm: "AES-GCM" });
  expect(record!.iv).toHaveLength(12);
  expect(record!.storedText).not.toContain(token);
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.reload();
  expect(await vault(page, "load")).toBe(token);
});

test("replacing a token rotates encryption and explicit deletion survives reload", async ({ page }) => {
  await page.goto("/");
  await vault(page, "save", "first-test-only-token");
  const first = await recordInfo(page);
  await vault(page, "save", "second-test-only-token");
  const second = await recordInfo(page);
  expect(first!.iv).not.toEqual(second!.iv);
  expect(first!.ciphertext).not.toEqual(second!.ciphertext);
  expect(await vault(page, "load")).toBe("second-test-only-token");
  await page.evaluate(async () => {
    const path = "/src/lib/vault.ts";
    const api = await import(/* @vite-ignore */ path);
    // A rapid logout must win even while a save is waiting on encryption.
    await Promise.all([api.saveToken("queued-test-token"), api.clearToken()]);
  });
  expect(await recordInfo(page)).toBeNull();
  await page.reload();
  expect(await vault(page, "load")).toBeNull();
});

test("corruption reports an unlock error and preserves the record for explicit logout", async ({ page }) => {
  await page.goto("/");
  await vault(page, "save", "test-only-token");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("issueflow-vault", 1);
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("credentials", "readwrite");
      const store = tx.objectStore("credentials");
      const request = store.get("github");
      request.onsuccess = () => store.put({ ...request.result, ciphertext: new Uint8Array([0]).buffer }, "github");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  });
  const code = await page.evaluate(async () => {
    const path = "/src/lib/vault.ts";
    const api = await import(/* @vite-ignore */ path);
    try { await api.loadToken(); } catch (error) { return (error as { code: string }).code; }
  });
  expect(code).toBe("decrypt");
  expect(await recordInfo(page)).not.toBeNull();
  await vault(page, "clear");
  expect(await recordInfo(page)).toBeNull();
});
