import { useCallback, useEffect, useRef, useState } from "react";

import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type { MediaAsset } from "../../api-types";

/** A photo picked on this device that is on its way to the trip's private library, or did not get there. */
export type CaptureUpload = {
  key: string;
  tripId: string;
  name: string;
  previewUrl: string | null;
  status: "uploading" | "failed";
  error: string | null;
};

type Pending = CaptureUpload & { file: File };

/** The same file picked twice is the same file: name, size and modification time identify it. */
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

function previewOf(file: File): string | null {
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

/**
 * Uploads photos chosen in Capture one after another to the trip's private library, then hands each stored asset
 * over so the draft can link it. A file already uploading or uploaded in this session is skipped; the server also
 * keeps one copy of identical bytes per trip. A failed file stays listed so it can be tried again or dropped.
 */
export function useCaptureUploads(tripId: string | null, onUploaded: (asset: MediaAsset) => void) {
  const [items, setItems] = useState<Pending[]>([]);
  const [uploaded, setUploaded] = useState<MediaAsset[]>([]);
  const seen = useRef(new Set<string>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const current = useRef(tripId);
  const handOver = useRef(onUploaded);
  handOver.current = onUploaded;
  const previews = useRef(new Set<string>());

  const upload = useOwnerMutation<{ tripId: string; body: FormData }, MediaAsset>({
    fallback: m.assets_the_media_could_not_be_uploaded,
    request: ({ tripId: target, body }) => ({
      path: `${tripPath(target, "media")}/uploads`,
      method: "POST",
      body,
    }),
    invalidate: (subject, { tripId: target }) => [ownerKeys.tripResource(subject, target, "media")],
  });

  const forget = useCallback((key: string) => {
    setItems((list) => {
      const gone = list.find((item) => item.key === key);
      if (gone?.previewUrl) {
        URL.revokeObjectURL(gone.previewUrl);
        previews.current.delete(gone.previewUrl);
      }
      return list.filter((item) => item.key !== key);
    });
  }, []);

  const run = useCallback(
    async (item: Pending) => {
      setItems((list) =>
        list.map((entry) =>
          entry.key === item.key ? { ...entry, status: "uploading", error: null } : entry,
        ),
      );
      try {
        const body = new FormData();
        body.set("file", item.file);
        const asset = await upload.mutateAsync({ tripId: item.tripId, body });
        // The owner may have moved on to another trip while this was uploading; the photo then stays in the library only.
        if (current.current !== item.tripId) return;
        setUploaded((list) =>
          list.some((entry) => entry.id === asset.id) ? list : [...list, asset],
        );
        handOver.current(asset);
        forget(item.key);
      } catch (error) {
        seen.current.delete(item.key);
        setItems((list) =>
          list.map((entry) =>
            entry.key === item.key
              ? {
                  ...entry,
                  status: "failed",
                  error: errorMessage(error, m.assets_the_media_could_not_be_uploaded),
                }
              : entry,
          ),
        );
      }
    },
    [forget, upload],
  );

  const enqueue = useCallback(
    (item: Pending) => {
      queue.current = queue.current.then(() => run(item));
    },
    [run],
  );

  const add = useCallback(
    (files: File[]) => {
      if (!tripId) return;
      const fresh: Pending[] = [];
      for (const file of files) {
        const key = fileKey(file);
        if (seen.current.has(key)) continue;
        seen.current.add(key);
        const previewUrl = previewOf(file);
        if (previewUrl) previews.current.add(previewUrl);
        fresh.push({
          key,
          tripId,
          name: file.name,
          previewUrl,
          status: "uploading",
          error: null,
          file,
        });
      }
      if (!fresh.length) return;
      setItems((list) => [
        ...list.filter((item) => !fresh.some((one) => one.key === item.key)),
        ...fresh,
      ]);
      for (const item of fresh) enqueue(item);
    },
    [enqueue, tripId],
  );

  const retry = useCallback(
    (key: string) => {
      const item = items.find((entry) => entry.key === key);
      if (!item) return;
      seen.current.add(key);
      enqueue(item);
    },
    [enqueue, items],
  );

  const drop = useCallback(
    (key: string) => {
      seen.current.delete(key);
      forget(key);
    },
    [forget],
  );

  const reset = useCallback(() => {
    for (const url of previews.current) URL.revokeObjectURL(url);
    previews.current.clear();
    seen.current.clear();
    setItems([]);
  }, []);

  // Photos waiting for one trip are not carried over to another.
  useEffect(() => {
    current.current = tripId;
    reset();
  }, [tripId, reset]);
  useEffect(() => reset, [reset]);

  const visible = items.filter((item) => item.tripId === tripId);
  return {
    items: visible as CaptureUpload[],
    uploaded,
    busy: visible.some((item) => item.status === "uploading"),
    failed: visible.some((item) => item.status === "failed"),
    add,
    retry,
    drop,
    reset,
  };
}
