const DB_NAME = "travel-offline-v1";
const DB_VERSION = 1;
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
};

export type KeyDisclosure = { subject: string; exportable: boolean; createdAt: number };

export class OfflineUnsupportedError extends Error {
  constructor() {
    super("Offline opslag wordt niet ondersteund in deze browser.");
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
        if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE, { keyPath: "subject" });
        if (!db.objectStoreNames.contains(COPIES_STORE)) {
          const store = db.createObjectStore(COPIES_STORE, { keyPath: "id" });
          store.createIndex(SUBJECT_INDEX, "subject", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("De offline database kon niet worden geopend."));
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
    request.onerror = () => reject(request.error ?? new Error("De offline actie is mislukt."));
  });
}

function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("De offline actie is mislukt."));
    transaction.onabort = () => reject(transaction.error ?? new Error("De offline actie is afgebroken."));
  });
}

async function getKeyRecord(
  db: IDBDatabase,
  subject: string,
): Promise<{ subject: string; key: CryptoKey; exportable: boolean; createdAt: number } | null> {
  const record = await promisifyRequest(db.transaction(KEYS_STORE, "readonly").objectStore(KEYS_STORE).get(subject));
  return (record as { subject: string; key: CryptoKey; exportable: boolean; createdAt: number } | undefined) ?? null;
}

async function putKeyRecord(
  db: IDBDatabase,
  record: { subject: string; key: CryptoKey; exportable: boolean; createdAt: number },
): Promise<void> {
  const transaction = db.transaction(KEYS_STORE, "readwrite");
  transaction.objectStore(KEYS_STORE).put(record);
  await promisifyTransaction(transaction);
}

async function deleteKeyRecord(db: IDBDatabase, subject: string): Promise<void> {
  const transaction = db.transaction(KEYS_STORE, "readwrite");
  transaction.objectStore(KEYS_STORE).delete(subject);
  await promisifyTransaction(transaction);
}

/**
 * A non-extractable key stored via IndexedDB structured clone never exposes its raw
 * bytes to application code; some older browsers cannot clone such a key at all, so we
 * fall back to an extractable one and disclose that downgrade to the owner.
 */
export async function getOrCreateDeviceKey(subject: string): Promise<{ key: CryptoKey; exportable: boolean }> {
  const db = await openDb();
  const existing = await getKeyRecord(db, subject);
  if (existing) return existing;

  const createdAt = Date.now();
  try {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await putKeyRecord(db, { subject, key, exportable: false, createdAt });
    return { key, exportable: false };
  } catch {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    await putKeyRecord(db, { subject, key, exportable: true, createdAt });
    return { key, exportable: true };
  }
}

export async function getKeyDisclosure(subject: string): Promise<KeyDisclosure | null> {
  const db = await openDb();
  const record = await getKeyRecord(db, subject);
  return record ? { subject: record.subject, exportable: record.exportable, createdAt: record.createdAt } : null;
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
  const record = await promisifyRequest(db.transaction(COPIES_STORE, "readonly").objectStore(COPIES_STORE).get(id));
  return (record as OfflineCopyRecord | undefined) ?? null;
}

async function putCopy(db: IDBDatabase, record: OfflineCopyRecord): Promise<void> {
  const transaction = db.transaction(COPIES_STORE, "readwrite");
  transaction.objectStore(COPIES_STORE).put(record);
  await promisifyTransaction(transaction);
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
  const match = records.find((record) => record.resourceKind === resourceKind && record.resourceId === resourceId);
  return match ? toSummary(match) : null;
}

export async function pinOfflineCopy(input: PinInput): Promise<OfflineCopySummary> {
  const db = await openDb();
  const { key } = await getOrCreateDeviceKey(input.subject);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, input.bytes);
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
    pinnedAt: existing?.pinnedAt ?? now,
    lastValidatedAt: now,
    leaseExpiresAt: now + OFFLINE_LEASE_MS,
    schemaVersion: OFFLINE_SCHEMA_VERSION,
  };
  await putCopy(db, record);
  return toSummary(record);
}

export async function listOfflineCopies(subject: string): Promise<OfflineCopySummary[]> {
  const db = await openDb();
  const records = await getCopiesForSubject(db, subject);
  const now = Date.now();
  const fresh: OfflineCopyRecord[] = [];
  for (const record of records) {
    if (record.leaseExpiresAt <= now) {
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
  await clearOfflineCopies(subject);
  await deleteKeyRecord(db, subject);
}

export async function openOfflineCopy(subject: string, id: string): Promise<Blob> {
  const db = await openDb();
  const record = await getCopy(db, id);
  if (!record || record.subject !== subject)
    throw new Error("Deze offline kopie is niet beschikbaar voor dit account.");
  if (record.leaseExpiresAt <= Date.now()) {
    await deleteCopy(db, id);
    throw new Error(
      "De offline geldigheidsperiode van deze kopie is verlopen. Verbind opnieuw met internet om ze te vernieuwen.",
    );
  }
  const { key } = await getOrCreateDeviceKey(subject);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv as BufferSource },
    key,
    record.ciphertext,
  );
  return new Blob([plaintext], { type: record.contentType });
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
  const records = await getCopiesForSubject(db, subject);
  const now = Date.now();
  let removed = 0;
  for (const record of records) {
    if (record.leaseExpiresAt <= now) {
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
      await putCopy(db, { ...record, lastValidatedAt: now, leaseExpiresAt: now + OFFLINE_LEASE_MS });
    } catch {
      // Offline or a transient network failure: leave the copy as-is until the next reconnect.
    }
  }
  return { checked: records.length, removed };
}
