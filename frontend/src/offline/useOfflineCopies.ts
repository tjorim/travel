import { useCallback, useEffect, useState } from "react";

import { decodeSubject } from "../auth";
import { useAuth } from "../auth-context";
import { apiHeaders } from "../tracker-model";
import {
  clearOfflineCopies,
  getKeyDisclosure,
  isStoragePersisted,
  listOfflineCopies,
  openOfflineCopy,
  pinOfflineCopy,
  removeOfflineCopy,
  requestPersistentStorage,
  revalidateOfflineCopies,
  OfflineUnsupportedError,
  type KeyDisclosure,
  type OfflineCopySummary,
  type OfflineResourceKind,
  type PinInput,
} from "./offline-store";

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
  const [loaded, setLoaded] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [disclosure, setDisclosure] = useState<KeyDisclosure | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    if (!subject) {
      setCopies([]);
      setLoaded(true);
      return;
    }
    try {
      const loadedCopies = await listOfflineCopies(subject);
      setCopies(loadedCopies);
      setDisclosure(await getKeyDisclosure(subject));
      if (loadedCopies.length > 0) setPersisted(await isStoragePersisted());
    } catch (error) {
      if (error instanceof OfflineUnsupportedError) setUnsupported(true);
    } finally {
      setLoaded(true);
    }
  }, [subject]);

  useEffect(() => {
    void refresh();
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
    void revalidateOfflineCopies(subject, (url) => fetch(url, { headers: apiHeaders(session) })).then(() => refresh());
    // Intentionally re-runs only when connectivity flips back on or the signed-in subject changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, online]);

  return {
    subject,
    copies,
    loaded,
    unsupported,
    online,
    disclosure,
    persisted,
    isPinned: (resourceKind, resourceId) => copies.some((copy) => copy.resourceKind === resourceKind && copy.resourceId === resourceId),
    async pin(input) {
      if (!subject) throw new Error("Meld aan om iets offline te bewaren.");
      await pinOfflineCopy({ ...input, subject });
      setPersisted(await requestPersistentStorage());
      await refresh();
    },
    async removeByResource(resourceKind, resourceId) {
      const match = copies.find((copy) => copy.resourceKind === resourceKind && copy.resourceId === resourceId);
      if (!match) return;
      await removeOfflineCopy(match.id);
      await refresh();
    },
    async remove(id) {
      await removeOfflineCopy(id);
      await refresh();
    },
    async clearAll() {
      if (!subject) return;
      await clearOfflineCopies(subject);
      await refresh();
    },
    async open(id) {
      if (!subject) throw new Error("Meld aan om een offline kopie te openen.");
      return openOfflineCopy(subject, id);
    },
  };
}
