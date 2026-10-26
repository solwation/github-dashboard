import { PUBLIC_MODE_KEY } from "./public-workspace";

/** Encrypted, origin-local account settings (selected repositories, layout, rules, filters,
 * read markers). Unlike the credential vault, records and their non-exportable key survive
 * confirmed logout so the same account gets its settings back after signing in again.
 * Records are bound to the account login through AES-GCM additional data and never mix.
 */
export const SETTINGS_DATABASE = "issueflow-settings";
const STORE = "settings";
const KEY = "key";
/** Plaintext localStorage prefix used before settings were encrypted; migrated and removed. */
export const LEGACY_SETTINGS_PREFIX = "issueflow:";

export class SettingsStorageError extends Error {
  constructor(options?: ErrorOptions) {
    super("Account settings storage is unavailable.", options);
    this.name = "SettingsStorageError";
  }
}
type SettingsRecord = { iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (cause?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new SettingsStorageError({ cause }));
    };
    const timeout = setTimeout(() => fail("blocked"), 5000);
    try {
      if (!globalThis.indexedDB || !globalThis.crypto?.subtle) return fail("unavailable");
      const request = indexedDB.open(SETTINGS_DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail("blocked");
      request.onsuccess = () => {
        if (settled) return request.result.close();
        settled = true;
        clearTimeout(timeout);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    } catch (cause) {
      fail(cause);
    }
  });
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  // Like the vault, close after each transaction so a frozen or closing tab never holds it open.
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(new SettingsStorageError({ cause: tx.error ?? request.error }));
    });
  } catch (cause) {
    throw cause instanceof SettingsStorageError ? cause : new SettingsStorageError({ cause });
  } finally {
    db.close();
  }
}

// Keep loads, migrations and saves in call order so a later save is never overwritten.
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => {});
  return result;
}

const encoder = new TextEncoder();
const purpose = (login: string) => encoder.encode("issueflow-settings:v1:" + login);
/** Record ids are hashed so even IndexedDB keys carry no account name. */
const ids = new Map<string, Promise<string>>();
function recordId(login: string): Promise<string> {
  if (!ids.has(login)) ids.set(login, hashLogin(login));
  return ids.get(login)!;
}
async function hashLogin(login: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", purpose(login)));
  return "account:" + Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

/** The key is generated once per origin and kept across logout; a concurrent tab's key wins. */
let cachedKey: CryptoKey | null = null; // Never deleted once stored, so safe to keep in memory.
async function storedKey(create: boolean): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  cachedKey = await findOrCreateKey(create);
  return cachedKey;
}
async function findOrCreateKey(create: boolean): Promise<CryptoKey | null> {
  const existing = await transact<CryptoKey | undefined>("readonly", store => store.get(KEY));
  if (existing || !create) return existing ?? null;
  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  let chosen = candidate;
  await transact("readwrite", store => {
    const request = store.get(KEY);
    request.onsuccess = () => {
      if (request.result) chosen = request.result as CryptoKey;
      else store.put(candidate, KEY);
    };
    return request;
  });
  return chosen;
}

async function read(login: string): Promise<unknown | null> {
  const key = await storedKey(false);
  if (!key) return null;
  const id = await recordId(login);
  const saved = await transact<SettingsRecord | undefined>("readonly", store => store.get(id));
  if (!saved) return null;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: saved.iv, additionalData: purpose(login) }, key, saved.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return null; // A damaged record behaves as absent and may be replaced.
  }
}

async function write(login: string, json: string): Promise<void> {
  const key = (await storedKey(true))!;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: purpose(login) }, key, encoder.encode(json));
  const id = await recordId(login);
  await transact("readwrite", store => store.put({ iv, ciphertext } satisfies SettingsRecord, id));
}

function legacyKeys(): string[] {
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => Boolean(key?.startsWith(LEGACY_SETTINGS_PREFIX) && key !== PUBLIC_MODE_KEY));
  } catch {
    return [];
  }
}

/** Moves every account's plaintext settings into encrypted storage, then deletes the plaintext.
 * An existing encrypted record wins; plaintext is kept only if encrypting it failed. */
async function migrateLegacy(): Promise<void> {
  for (const storageKey of legacyKeys()) {
    const login = storageKey.slice(LEGACY_SETTINGS_PREFIX.length);
    let value: unknown = null;
    try { value = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch { /* Invalid plaintext is discarded. */ }
    if (login && value && typeof value === "object" && await read(login) === null) await write(login, JSON.stringify(value));
    try { localStorage.removeItem(storageKey); } catch { /* Retried on the next load. */ }
  }
}

/** Runs legacy settings migration once at startup, swallowing storage errors so startup is never blocked. */
export function migrateLegacySettings(): Promise<void> {
  return serialize(async () => {
    try {
      await migrateLegacy();
    } catch {
      /* Storage errors are swallowed and never block startup. */
    }
  });
}

void migrateLegacySettings();

/** Resolves the saved settings for `login`, or null when none exist (or they are damaged).
 * Rejects with SettingsStorageError on storage failures so callers can avoid overwriting them. */
export function loadSettings(login: string): Promise<unknown | null> {
  return serialize(async () => {
    try {
      await migrateLegacy();
      return await read(login);
    } catch (cause) {
      throw cause instanceof SettingsStorageError ? cause : new SettingsStorageError({ cause });
    }
  });
}

/** Snapshots `value` immediately; later reactive mutations do not affect the queued write. */
export function saveSettings(login: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  return serialize(async () => {
    try {
      await write(login, json);
    } catch (cause) {
      throw cause instanceof SettingsStorageError ? cause : new SettingsStorageError({ cause });
    }
  });
}
