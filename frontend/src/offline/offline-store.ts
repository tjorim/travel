import { FeedbackError } from "../query/feedback";
import { m } from "../paraglide/messages.js";
/** Keep native storage diagnostics separate from the localized operation message. */
function storageFailure(describe: () => string, cause?: unknown): FeedbackError {
  const error = new FeedbackError(describe);
  error.cause = cause;
  return error;
}

const DB_NAME = "travel-offline-v1";
const DB_VERSION = 2;
const GENERATIONS_STORE = "generations";
const KEYS_STORE = "keys";
const COPIES_STORE = "copies";
const SUBJECT_INDEX = "by_subject";

export const OFFLINE_SCHEMA_VERSION = "travel/offline-copy@1";
export const OFFLINE_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineResourceKind =
  | "library_document"
  | "trip_document"
  | "emergency_info"
  | "media_asset"
  | "media_derivative"
  | "route_data"
  | "visit"
  | "packing_list";

export type OfflineCopyRecord = {
  id: string;
  subject: string;
  resourceKind: OfflineResourceKind;
  resourceId: string;
  metadataUrl: string;
  title: string;
  contentType: string;
  byteSize: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
  contentValidator?: string;
  newerVersionAvailable?: boolean;
  pinnedAt: number;
  lastValidatedAt: number;
  leaseExpiresAt: number;
  schemaVersion: string;
};

export type OfflineCopySummary = Omit<OfflineCopyRecord, "iv" | "ciphertext">;

export type PinInput = {
  subject: string;
  resourceKind: OfflineResourceKind;
  resourceId: string;
  metadataUrl: string;
  title: string;
  contentType: string;
  bytes: ArrayBuffer;
  contentMetadata?: unknown;
  contentValidator?: string;
};

export type KeyDisclosure = { subject: string; exportable: boolean; createdAt: number };

export class OfflineUnsupportedError extends FeedbackError {
  constructor() {
    super(() => m.assets_offline_storage_is_not_supported_in_this_browser());
    this.name = "OfflineUnsupportedError";
  }
}

/**
 * Asks the browser not to evict this origin's storage under pressure without
 * asking first. Best-effort and non-blocking: some browsers grant it silently
 * based on site engagement, Firefox may prompt the user, and older browsers
 * lack the API entirely — `null` means "unknown", not "denied".
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return null;
  try {
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isStoragePersisted(): Promise<boolean | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

function assertSupported(): void {
  if (typeof indexedDB === "undefined" || typeof crypto === "undefined" || !crypto.subtle) {
    throw new OfflineUnsupportedError();
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  assertSupported();
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(GENERATIONS_STORE))
          db.createObjectStore(GENERATIONS_STORE);
        if (!db.objectStoreNames.contains(KEYS_STORE))
          db.createObjectStore(KEYS_STORE, { keyPath: "subject" });
        if (!db.objectStoreNames.contains(COPIES_STORE)) {
          const store = db.createObjectStore(COPIES_STORE, { keyPath: "id" });
          store.createIndex(SUBJECT_INDEX, "subject", { unique: false });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          dbPromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () =>
        reject(storageFailure(m.assets_the_offline_database_could_not_be_opened, request.error));
    });
  }
  return dbPromise;
}

/**
 * Test-only: forces the next call to reopen IndexedDB, mimicking a page reload.
 * Closes the current connection first so a subsequent `deleteDatabase` in test
 * teardown does not block on a dangling open handle.
 */
export async function __resetOfflineStoreForTests(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // The connection may already be closed or the open request may have failed; ignore.
  }
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(storageFailure(m.assets_the_offline_action_failed, request.error));
  });
}

function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(storageFailure(m.assets_the_offline_action_failed, transaction.error));
    transaction.onabort = () =>
      reject(storageFailure(m.assets_the_offline_action_was_aborted, transaction.error));
  });
}

async function getKeyRecord(
  db: IDBDatabase,
  subject: string,
): Promise<{ subject: string; key: CryptoKey; exportable: boolean; createdAt: number } | null> {
  const record = await promisifyRequest(
    db.transaction(KEYS_STORE, "readonly").objectStore(KEYS_STORE).get(subject),
  );
  return (
    (record as
      | { subject: string; key: CryptoKey; exportable: boolean; createdAt: number }
      | undefined) ?? null
  );
}

async function getGeneration(db: IDBDatabase, subject: string): Promise<number> {
  return (
    (await promisifyRequest(
      db.transaction(GENERATIONS_STORE).objectStore(GENERATIONS_STORE).get(subject),
    )) ?? 0
  );
}

/** Compare the logout generation in the same transaction as the write, including across tabs. */
async function guardedPut(
  db: IDBDatabase,
  store: string,
  subject: string,
  generation: number,
  record: unknown,
): Promise<void> {
  const transaction = db.transaction([store, GENERATIONS_STORE], "readwrite");
  const done = promisifyTransaction(transaction);
  const request = transaction.objectStore(GENERATIONS_STORE).get(subject);
  request.onsuccess = () => {
    if ((request.result ?? 0) !== generation) transaction.abort();
    else transaction.objectStore(store).put(record);
  };
  await done;
}

/**
 * A non-extractable key stored via IndexedDB structured clone never exposes its raw
 * bytes to application code; some older browsers cannot clone such a key at all, so we
 * fall back to an extractable one and disclose that downgrade to the owner.
 */
export async function getOrCreateDeviceKey(
  subject: string,
  expectedGeneration?: number,
): Promise<{ key: CryptoKey; exportable: boolean }> {
  const db = await openDb();
  const generation = expectedGeneration ?? (await getGeneration(db, subject));
  const existing = await getKeyRecord(db, subject);
  if (existing) return existing;

  const createdAt = Date.now();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
      "encrypt",
      "decrypt",
    ]);
    await guardedPut(db, KEYS_STORE, subject, generation, {
      subject,
      key,
      exportable: false,
      createdAt,
    });
    return { key, exportable: false };
  } catch {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    await guardedPut(db, KEYS_STORE, subject, generation, {
      subject,
      key,
      exportable: true,
      createdAt,
    });
    return { key, exportable: true };
  }
}

export async function getKeyDisclosure(subject: string): Promise<KeyDisclosure | null> {
  const db = await openDb();
  const record = await getKeyRecord(db, subject);
  return record
    ? { subject: record.subject, exportable: record.exportable, createdAt: record.createdAt }
    : null;
}

async function getCopiesForSubject(db: IDBDatabase, subject: string): Promise<OfflineCopyRecord[]> {
  const request = db
    .transaction(COPIES_STORE, "readonly")
    .objectStore(COPIES_STORE)
    .index(SUBJECT_INDEX)
    .getAll(subject);
  return promisifyRequest(request) as Promise<OfflineCopyRecord[]>;
}

async function getCopy(db: IDBDatabase, id: string): Promise<OfflineCopyRecord | null> {
  const record = await promisifyRequest(
    db.transaction(COPIES_STORE, "readonly").objectStore(COPIES_STORE).get(id),
  );
  return (record as OfflineCopyRecord | undefined) ?? null;
}

async function deleteCopy(db: IDBDatabase, id: string): Promise<void> {
  const transaction = db.transaction(COPIES_STORE, "readwrite");
  transaction.objectStore(COPIES_STORE).delete(id);
  await promisifyTransaction(transaction);
}

function toSummary(record: OfflineCopyRecord): OfflineCopySummary {
  const { iv: _iv, ciphertext: _ciphertext, ...summary } = record;
  return summary;
}

export async function findPinnedCopy(
  subject: string,
  resourceKind: OfflineResourceKind,
  resourceId: string,
): Promise<OfflineCopySummary | null> {
  const db = await openDb();
  const records = await getCopiesForSubject(db, subject);
  const match = records.find(
    (record) =>
      record.schemaVersion === OFFLINE_SCHEMA_VERSION &&
      record.leaseExpiresAt > Date.now() &&
      record.resourceKind === resourceKind &&
      record.resourceId === resourceId,
  );
  return match ? toSummary(match) : null;
}

export async function pinOfflineCopy(input: PinInput): Promise<OfflineCopySummary> {
  const db = await openDb();
  const generation = await getGeneration(db, input.subject);
  const { key } = await getOrCreateDeviceKey(input.subject, generation);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle
    .encrypt({ name: "AES-GCM", iv }, key, input.bytes)
    .catch((cause: unknown) => {
      throw storageFailure(m.assets_the_offline_action_failed, cause);
    });
  const now = Date.now();
  const existing = await findPinnedCopy(input.subject, input.resourceKind, input.resourceId);
  const record: OfflineCopyRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    subject: input.subject,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    metadataUrl: input.metadataUrl,
    title: input.title,
    contentType: input.contentType,
    byteSize: input.bytes.byteLength,
    iv,
    ciphertext,
    pinnedAt: now,
    contentValidator: input.contentValidator,
    newerVersionAvailable: false,
    lastValidatedAt: now,
    leaseExpiresAt: now + OFFLINE_LEASE_MS,
    schemaVersion: OFFLINE_SCHEMA_VERSION,
  };
  await guardedPut(db, COPIES_STORE, input.subject, generation, record);
  return toSummary(record);
}

export async function listOfflineCopies(subject: string): Promise<OfflineCopySummary[]> {
  const db = await openDb();
  const records = await getCopiesForSubject(db, subject);
  const now = Date.now();
  const fresh: OfflineCopyRecord[] = [];
  for (const record of records) {
    if (record.schemaVersion !== OFFLINE_SCHEMA_VERSION || record.leaseExpiresAt <= now) {
      await deleteCopy(db, record.id);
      continue;
    }
    fresh.push(record);
  }
  return fresh.map(toSummary).sort((a, b) => b.pinnedAt - a.pinnedAt);
}

export async function removeOfflineCopy(id: string): Promise<void> {
  const db = await openDb();
  await deleteCopy(db, id);
}

export async function clearOfflineCopies(subject: string): Promise<void> {
  const db = await openDb();
  const records = await getCopiesForSubject(db, subject);
  for (const record of records) await deleteCopy(db, record.id);
}

export async function wipeOfflineData(subject: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction([COPIES_STORE, KEYS_STORE, GENERATIONS_STORE], "readwrite");
  const done = promisifyTransaction(transaction);
  const generations = transaction.objectStore(GENERATIONS_STORE);
  const generation = generations.get(subject);
  generation.onsuccess = () => generations.put((generation.result ?? 0) + 1, subject);
  transaction.objectStore(KEYS_STORE).delete(subject);
  const cursor = transaction.objectStore(COPIES_STORE).index(SUBJECT_INDEX).openCursor(subject);
  cursor.onsuccess = () => {
    const current = cursor.result;
    if (current) {
      current.delete();
      current.continue();
    }
  };
  await done;
}

export async function openOfflineCopy(subject: string, id: string): Promise<Blob> {
  const db = await openDb();
  const record = await getCopy(db, id);
  if (!record || record.subject !== subject)
    throw new FeedbackError(() => m.assets_this_offline_copy_is_not_available_for_this_account());
  if (record.schemaVersion !== OFFLINE_SCHEMA_VERSION) {
    await deleteCopy(db, id);
    throw new FeedbackError(() => m.assets_this_offline_copy_is_not_available_for_this_account());
  }
  if (record.leaseExpiresAt <= Date.now()) {
    await deleteCopy(db, id);
    throw new FeedbackError(() =>
      m.assets_the_offline_validity_period_of_this_copy_has_expired_reconnect_to_the_in(),
    );
  }
  const { key } = await getOrCreateDeviceKey(subject);
  const plaintext = await crypto.subtle
    .decrypt({ name: "AES-GCM", iv: record.iv as BufferSource }, key, record.ciphertext)
    .catch((cause: unknown) => {
      throw storageFailure(m.assets_the_offline_copy_could_not_be_opened, cause);
    });
  return new Blob([plaintext], { type: record.contentType });
}

/** Hash metadata without storing its private fields in plaintext. */
export async function offlineContentValidator(value: unknown): Promise<string> {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, canonical(value)]),
      );
    return value;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical(value))),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type RevalidateFetch = (metadataUrl: string) => Promise<Response>;

/**
 * Confirms every pinned copy is still owned/accessible. Called on reconnect: the
 * lease alone bounds how long a genuinely offline device may keep reading a copy,
 * but a live check removes copies that were deleted, unshared or re-owned sooner.
 */
export async function revalidateOfflineCopies(
  subject: string,
  fetchImpl: RevalidateFetch,
): Promise<{ checked: number; removed: number }> {
  const db = await openDb();
  const generation = await getGeneration(db, subject);
  const records = await getCopiesForSubject(db, subject);
  const now = Date.now();
  let removed = 0;
  for (const record of records) {
    if (record.schemaVersion !== OFFLINE_SCHEMA_VERSION || record.leaseExpiresAt <= now) {
      await deleteCopy(db, record.id);
      removed += 1;
      continue;
    }
    try {
      const response = await fetchImpl(record.metadataUrl);
      if (response.status === 404 || response.status === 403 || response.status === 401) {
        await deleteCopy(db, record.id);
        removed += 1;
        continue;
      }
      if (!response.ok) continue;
      let newerVersionAvailable = record.newerVersionAvailable;
      if (record.contentValidator) {
        try {
          newerVersionAvailable =
            record.contentValidator !== (await offlineContentValidator(await response.json()));
        } catch {
          // Missing metadata cannot establish content freshness.
        }
      }
      await guardedPut(db, COPIES_STORE, subject, generation, {
        ...record,
        newerVersionAvailable,
        lastValidatedAt: now,
        leaseExpiresAt: now + OFFLINE_LEASE_MS,
      });
    } catch {
      // Offline or a transient network failure: leave the copy as-is until the next reconnect.
    }
  }
  return { checked: records.length, removed };
}
