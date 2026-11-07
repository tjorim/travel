import { useEffect, useRef, useState } from "react";

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
  lazy = false,
}: {
  session: TrackerSession;
  url: string;
  alt: string;
  className?: string;
  /** Wait to fetch until the placeholder (which holds the image's size) nears the viewport. */
  lazy?: boolean;
}) {
  useLocale();
  const [src, setSrc] = useState<string | null>(null);
  const placeholder = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(!lazy || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const node = placeholder.current;
    if (near || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);
  useEffect(() => {
    if (!near) return;
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
  }, [session, url, near]);
  if (!src)
    return (
      <span
        ref={placeholder}
        className={`${className ?? ""} media-thumbnail-placeholder`}
        aria-hidden="true"
      />
    );
  return <img className={className} src={src} alt={alt} />;
}
