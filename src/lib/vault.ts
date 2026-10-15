/** Encrypted, origin-local credentials. Only clearToken explicitly removes a token.
 * The non-exportable key protects stored bytes; same-origin scripts can still use it.
 */
export const VAULT_DATABASE = "issueflow-vault";
const STORE = "credentials";
const RECORD = "github";
const CONTENT = "content";
const MAX_CONTENT_BYTES = 8 * 1024 * 1024;
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
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  const code = mode === "readonly" ? "read" : "write";
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      // Wait for commit; a successful request can still belong to an aborted transaction.
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(new VaultError(code, { cause: tx.error ?? request.error }));
      tx.onerror = () =>
        reject(new VaultError(code, { cause: tx.error ?? request.error }));
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
export function saveContent(token: string, value: unknown): Promise<void> {
  // Snapshot now, before later reactive UI mutations or queued operations.
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.byteLength > MAX_CONTENT_BYTES) return Promise.reject(new Error("Content cache limit exceeded"));
  return serialize(async () => {
    const credential = await transact<Credential | undefined>("readonly", store => store.get(RECORD));
    if (!credential || await decryptToken(credential) !== token) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(CONTENT) }, credential.key, plaintext);
    await transact("readwrite", store => {
      const request = store.get(RECORD);
      request.onsuccess = () => {
        const current = request.result as Credential | undefined;
        // A different tab may have logged out or replaced the token during encryption.
        const bytes = new Uint8Array(credential.ciphertext);
        if (current && bytes.length === current.ciphertext.byteLength && bytes.every((byte, i) => byte === new Uint8Array(current.ciphertext)[i]))
          store.put({ iv, ciphertext }, CONTENT);
      };
      return request;
    });
  });
}

export function loadContent<T>(token: string): Promise<T | null> {
  return serialize(async () => {
    const credential = await transact<Credential | undefined>("readonly", store => store.get(RECORD));
    if (!credential || await decryptToken(credential) !== token) return null;
    const record = await transact<Omit<Credential, "key"> | undefined>("readonly", store => store.get(CONTENT));
    if (!record || record.ciphertext.byteLength > MAX_CONTENT_BYTES + 32) return null;
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: new TextEncoder().encode(CONTENT) }, credential.key, record.ciphertext);
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch { return null; } // Damaged cache must never prevent sign-in.
  });
}

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
