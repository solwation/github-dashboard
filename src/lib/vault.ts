/** Encrypted, origin-local credentials. Only clearToken explicitly removes a token.
 * The non-exportable key protects stored bytes; same-origin scripts can still use it.
 */
import { ContentCacheError, decodeContent, encodeContent, MAX_CONTENT_BYTES } from "./content-codec";
export { ContentCacheError, MAX_CONTENT_BYTES, MAX_EXPANDED_CONTENT_BYTES } from "./content-codec";
export type { ContentCacheErrorCode } from "./content-codec";

export const VAULT_DATABASE = "issueflow-vault";
const STORE = "credentials";
const RECORD = "github";
const CONTENT = "content";
export type VaultErrorCode =
  "unavailable" | "blocked" | "read" | "write" | "decrypt";
const messages: Record<VaultErrorCode, string> = {
  unavailable:
    "Webbläsaren stöder inte säker lagring. Använd en modern webbläsare via HTTPS.",
  blocked:
    "Säker lagring är blockerad. Stäng andra flikar med Issueflow och försök igen.",
  read: "Den sparade inloggningen kunde inte läsas. Försök igen.",
  write: "Inloggningen kunde inte sparas säkert i webbläsaren. Försök igen.",
  decrypt: "Den sparade inloggningen kunde inte låsas upp. Logga in igen.",
};
export class VaultError extends Error {
  constructor(
    public readonly code: VaultErrorCode,
    options?: ErrorOptions,
  ) {
    super(messages[code], options);
    this.name = "VaultError";
  }
}
type Credential = {
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (code: VaultErrorCode, cause?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new VaultError(code, { cause }));
    };
    const timeout = setTimeout(() => fail("blocked"), 5000);
    try {
      if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
        fail("unavailable");
        return;
      }
      const request = indexedDB.open(VAULT_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => fail("unavailable", request.error);
      request.onblocked = () => fail("blocked");
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        clearTimeout(timeout);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    } catch (cause) {
      fail("unavailable", cause);
    }
  });
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, abort: (cause: unknown) => void) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  const code = mode === "readonly" ? "read" : "write";
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let operationError: unknown;
      const request = operation(tx.objectStore(STORE), cause => { operationError = cause; tx.abort(); });
      // Wait for commit; a successful request can still belong to an aborted transaction.
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(new VaultError(code, { cause: operationError ?? tx.error ?? request.error }));
      tx.onerror = () =>
        reject(new VaultError(code, { cause: operationError ?? tx.error ?? request.error }));
    });
  } catch (cause) {
    throw cause instanceof VaultError ? cause : new VaultError(code, { cause });
  } finally {
    db.close();
  }
}

// Preserve call order, including logout requested while encryption is still running.
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => {});
  return result;
}

export function saveToken(token: string): Promise<void> {
  return serialize(async () => {
    if (!globalThis.crypto?.subtle) throw new VaultError("unavailable");
    try {
      const previous = await transact<Credential | undefined>("readonly", store => store.get(RECORD));
      if (previous) {
        try { if (await decryptToken(previous) === token) return; } catch { /* A fresh validated sign-in may replace a damaged credential. */ }
      }
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(token),
      );
      await transact("readwrite", (store) => {
        store.clear(); // Changed credentials invalidate all cached private content.
        return store.put({ key, iv, ciphertext } satisfies Credential, RECORD);
      });
    } catch (cause) {
      throw cause instanceof VaultError
        ? cause
        : new VaultError("write", { cause });
    }
  });
}

async function decryptToken(record: Credential): Promise<string> {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv }, record.key, record.ciphertext));
}

/** Cache uses the credential's non-exportable key, with an authenticated record purpose. */
function saveEncryptedContent(token: string, purpose: string, value: unknown): Promise<void> {
  // Snapshot now, before later reactive UI mutations or queued operations.
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  return serialize(async () => {
    const credential = await transact<Credential | undefined>("readonly", store => store.get(RECORD));
    if (!credential || await decryptToken(credential) !== token) return;
    const payload = await encodeContent(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(purpose) }, credential.key, payload);
    await transact("readwrite", (store, abort) => {
      const request = store.get(RECORD);
      request.onsuccess = () => {
        const current = request.result as Credential | undefined;
        // A different tab may have logged out or replaced the token during encryption.
        const bytes = new Uint8Array(credential.ciphertext);
        if (current && bytes.length === current.ciphertext.byteLength && bytes.every((byte, i) => byte === new Uint8Array(current.ciphertext)[i])) {
          try { store.put({ iv, ciphertext }, purpose); } catch (cause) { abort(cause); }
        }
      };
      return request;
    });
  }).catch(cause => {
    throw cause instanceof ContentCacheError ? cause : new ContentCacheError("storage", { cause });
  });
}

function loadEncryptedContent<T>(token: string, purpose: string): Promise<T | null> {
  return serialize(async () => {
    const credential = await transact<Credential | undefined>("readonly", store => store.get(RECORD));
    if (!credential || await decryptToken(credential) !== token) return null;
    const record = await transact<Omit<Credential, "key"> | undefined>("readonly", store => store.get(purpose));
    if (!record || record.ciphertext.byteLength > MAX_CONTENT_BYTES + 16) return null;
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(purpose) }, credential.key, record.ciphertext);
      return await decodeContent(new Uint8Array(plaintext)) as T;
    } catch { return null; } // Damaged cache must never prevent sign-in.
  });
}

/** Independent encrypted records share credential binding and atomic logout cleanup. */
export const saveContent = (token: string, value: unknown) => saveEncryptedContent(token, CONTENT, value);
export const loadContent = <T>(token: string) => loadEncryptedContent<T>(token, CONTENT);
export const saveStatistics = (token: string, value: unknown) => saveEncryptedContent(token, "statistics", value);
export const loadStatistics = <T>(token: string) => loadEncryptedContent<T>(token, "statistics");

export function loadToken(): Promise<string | null> {
  return serialize(async () => {
    const record = await transact<Credential | undefined>("readonly", (store) =>
      store.get(RECORD),
    );
    if (!record) return null;
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv },
        record.key,
        record.ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    } catch (cause) {
      // Keep the record intact so transient failures never silently log someone out.
      throw new VaultError("decrypt", { cause });
    }
  });
}

export function clearToken(): Promise<void> {
  return serialize(async () => {
    await transact("readwrite", (store) => store.clear());
  });
}
