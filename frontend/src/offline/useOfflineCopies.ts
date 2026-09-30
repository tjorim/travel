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
  const [copiesSubject, setCopiesSubject] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [disclosure, setDisclosure] = useState<KeyDisclosure | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const mounted = useRef(true);
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
    try {
      const loadedCopies = await listOfflineCopies(subject);
      const disclosure = await getKeyDisclosure(subject);
      const storage = loadedCopies.length > 0 ? await isStoragePersisted() : null;
      if (mounted.current && currentSubject.current === subject) {
        setCopies(loadedCopies);
        setCopiesSubject(subject);
        setDisclosure(disclosure);
        if (loadedCopies.length > 0) setPersisted(storage);
      }
    } catch (error) {
      if (mounted.current && currentSubject.current === subject && error instanceof OfflineUnsupportedError)
        setUnsupported(true);
    } finally {
      if (mounted.current && currentSubject.current === subject) setLoaded(true);
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
    // Only the status matters: a refused or missing record removes its copy, an unreachable server leaves it.
    const probe = (url: string) =>
      ownerRequest(session, url, m.assets_the_offline_copy_could_not_be_checked).then(
        () => new Response(null, { status: 200 }),
        (error: unknown) => {
          if (!(error instanceof ApiError)) return new Response(null, { status: 200 });
          if (error.offline) throw error;
          return new Response(null, { status: error.status });
        },
      );
    void revalidateOfflineCopies(subject, probe)
      .then(() => refresh())
      .catch((error: unknown) => {
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
      visibleCopies.some((copy) => copy.resourceKind === resourceKind && copy.resourceId === resourceId),
    async pin(input) {
      if (!subject) throw new FeedbackError(() => m.assets_sign_in_to_save_something_offline());
      await pinOfflineCopy({ ...input, subject });
      setPersisted(await requestPersistentStorage());
      await refresh();
    },
    async removeByResource(resourceKind, resourceId) {
      const match = visibleCopies.find((copy) => copy.resourceKind === resourceKind && copy.resourceId === resourceId);
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
      if (!subject) throw new FeedbackError(() => m.assets_sign_in_to_open_an_offline_copy());
      return openOfflineCopy(subject, id);
    },
  };
}
