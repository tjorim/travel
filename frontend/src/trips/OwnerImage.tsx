import { useEffect, useState } from "react";

import type { TrackerSession } from "../auth";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { ownerFile } from "../query/api";

/** Fetches a private, authenticated image as a blob and renders it inline, revoking the object URL on cleanup. */
export function OwnerImage({
  session,
  url,
  alt,
  className,
}: {
  session: TrackerSession;
  url: string;
  alt: string;
  className?: string;
}) {
  useLocale();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setSrc(null);
    ownerFile(session, url, m.assets_the_preview_could_not_be_loaded, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        /* No inline preview; the explicit open/download actions still work. */
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, url]);
  if (!src)
    return <span className={`${className ?? ""} media-thumbnail-placeholder`} aria-hidden="true" />;
  return <img className={className} src={src} alt={alt} />;
}
