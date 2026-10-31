import { FeedbackError } from "../query/feedback";
import { m } from "../paraglide/messages.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { decodeSubject } from "../auth";
import { useAuth } from "../auth-context";
import { ApiError, ownerRequest } from "../query/api";
import {
  clearOfflineCopies,
  getKeyDisclosure,
  isStoragePersisted,
  listOfflineCopies,
  openOfflineCopy,
  offlineContentValidator,
  pinOfflineCopy,
  removeOfflineCopy,
  requestPersistentStorage,
  revalidateOfflineCopies,
  subscribeOfflineChanges,
  notifyOfflineChanged,
  OfflineUnsupportedError,
  type KeyDisclosure,
  type OfflineCopySummary,
  type OfflineResourceKind,
  type PinInput,
} from "./offline-store";

/** Composite snapshots need validators for their child records as well as their parent. */
async function readOfflineMetadata(
  session: Parameters<typeof ownerRequest>[0],
  url: string,
): Promise<unknown> {
  const read = (path: string) =>
    ownerRequest(session, path, m.assets_the_offline_copy_could_not_be_checked, {
      cache: "no-store",
    });
  const metadata = await read(url);
  if (/\/packing-lists\/[^/]+$/.test(url))
    return { metadata, bags: await read(`${url}/bags`), items: await read(`${url}/items`) };
  if (url.endsWith("/offline-map")) {
    const base = url.slice(0, -"/offline-map".length);
    return {
      areas: await read(`${base}/areas`),
      locations: await read(`${base}/locations`),
      routes: await read(`${base}/routes`),
      visits: await read(`${base}/visits`),
    };
  }
  return metadata;
}

export type UseOfflineCopies = {
  subject: string | null;
  copies: OfflineCopySummary[];
  loaded: boolean;
  unsupported: boolean;
  online: boolean;
  disclosure: KeyDisclosure | null;
  persisted: boolean | null;
  isPinned: (resourceKind: OfflineResourceKind, resourceId: string) => boolean;
  pin: (input: Omit<PinInput, "subject">) => Promise<void>;
  removeByResource: (resourceKind: OfflineResourceKind, resourceId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  open: (id: string) => Promise<Blob>;
};

export function useOfflineCopies(): UseOfflineCopies {
  const { session } = useAuth();
  const subject = session ? decodeSubject(session.accessToken) : null;
  const [copies, setCopies] = useState<OfflineCopySummary[]>([]);
  const [copiesSubject, setCopiesSubject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [disclosure, setDisclosure] = useState<KeyDisclosure | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const mounted = useRef(true);
  const refreshSeq = useRef(0);
  const currentSubject = useRef(subject);
  currentSubject.current = subject;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!subject) {
      if (mounted.current && currentSubject.current === subject) {
        setCopies([]);
        setCopiesSubject(null);
        setLoaded(true);
      }
      return;
    }
    const seq = ++refreshSeq.current;
    try {
      const loadedCopies = await listOfflineCopies(subject);
      const disclosure = await getKeyDisclosure(subject);
      const storage = loadedCopies.length > 0 ? await isStoragePersisted() : null;
      if (mounted.current && currentSubject.current === subject && seq === refreshSeq.current) {
        setCopies(loadedCopies);
        setCopiesSubject(subject);
        setDisclosure(disclosure);
        setPersisted(loadedCopies.length > 0 ? storage : null);
      }
    } catch (error) {
      if (
        mounted.current &&
        currentSubject.current === subject &&
        error instanceof OfflineUnsupportedError
      )
        setUnsupported(true);
    } finally {
      if (mounted.current && currentSubject.current === subject) setLoaded(true);
    }
  }, [subject]);

  useEffect(() => {
    void refresh();
    // Every consumer reloads when any consumer, revalidation or sign-out changes the store.
    return subscribeOfflineChanges(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!subject || !session || !online) return;
    // Check access and metadata without replacing saved content.
    const probe = (url: string) =>
      readOfflineMetadata(session, url).then(
        (metadata) => Response.json(metadata),
        (error: unknown) => {
          if (!(error instanceof ApiError)) throw error;
          if (error.offline || error.status < 400) throw error;
          return new Response(null, { status: error.status });
        },
      );
    void revalidateOfflineCopies(subject, probe).catch((error: unknown) => {
      if (mounted.current && error instanceof OfflineUnsupportedError) setUnsupported(true);
    });
    // Intentionally re-runs only when connectivity flips back on or the signed-in subject changes.
  }, [subject, online]);

  const visibleCopies = copiesSubject === subject ? copies : [];
  return {
    subject,
    copies: visibleCopies,
    loaded,
    unsupported,
    online,
    disclosure,
    persisted,
    isPinned: (resourceKind, resourceId) =>
      visibleCopies.some(
        (copy) => copy.resourceKind === resourceKind && copy.resourceId === resourceId,
      ),
    async pin(input) {
      if (!subject) throw new FeedbackError(() => m.assets_sign_in_to_save_something_offline());
      if (!session) return;
      const metadata =
        input.contentMetadata ?? (await readOfflineMetadata(session, input.metadataUrl));
      await pinOfflineCopy({
        ...input,
        subject,
        contentValidator: await offlineContentValidator(metadata),
      });
      await requestPersistentStorage();
      // Persistence may have been granted after the pin: let every consumer re-read it.
      notifyOfflineChanged();
    },
    async removeByResource(resourceKind, resourceId) {
      const match = visibleCopies.find(
        (copy) => copy.resourceKind === resourceKind && copy.resourceId === resourceId,
      );
      if (!match) return;
      await removeOfflineCopy(match.id);
    },
    async remove(id) {
      await removeOfflineCopy(id);
    },
    async clearAll() {
      if (!subject) return;
      await clearOfflineCopies(subject);
    },
    async open(id) {
      if (!subject) throw new FeedbackError(() => m.assets_sign_in_to_open_an_offline_copy());
      return openOfflineCopy(subject, id);
    },
  };
}
