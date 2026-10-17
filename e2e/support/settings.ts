import type { Page } from "@playwright/test";
/** Decrypts an account's settings in the page, as same-origin app code can (the key is non-exportable). */
export function readSettings(page: Page, login: string): Promise<any> {
  return page.evaluate(async login => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("issueflow-settings", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("settings");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const get = (id: string) => new Promise<any>((resolve, reject) => {
      const request = db.transaction("settings").objectStore("settings").get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const aad = new TextEncoder().encode("issueflow-settings:v1:" + login);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", aad));
      const id = "account:" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
      const [key, record] = [await get("key"), await get(id)];
      if (!key || !record) return null;
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: aad }, key, record.ciphertext);
      return JSON.parse(new TextDecoder().decode(plaintext));
    } finally {
      db.close();
    }
  }, login);
}
