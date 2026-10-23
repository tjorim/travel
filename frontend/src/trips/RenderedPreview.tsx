import { useLocale } from "../locale";
import { errorNotice, useFeedback, textNotice, FeedbackError } from "../query/feedback";
import { m } from "../paraglide/messages.js";
import { useEffect, useState } from "react";

import type { TrackerSession } from "../auth";
import { ProjectionView, isProjection, type Audience, type Projection } from "../ProjectionView";
import { ownerFile, ownerRequest } from "../query/api";

export function RenderedPreview({
  projection,
  audience,
  tripId,
  linkId,
  session,
}: {
  projection: Projection;
  audience: Audience;
  tripId: string;
  linkId?: string;
  session: TrackerSession;
}) {
  useLocale();
  const [images, setImages] = useState<Record<string, string>>({});
  const [error, setError] = useFeedback<string>("");
  const base = `/api/trips/${encodeURIComponent(tripId)}/${audience === "public" ? "public-projection" : `share-links/${encodeURIComponent(linkId ?? "")}`}/preview`;

  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    setImages({});
    for (const item of projection.media) {
      const ids = [item.image, item.video, item.poster].flatMap((marker) =>
        marker && typeof marker === "object" && typeof (marker as { id?: unknown }).id === "string"
          ? [(marker as { id: string }).id]
          : [],
      );
      for (const id of ids)
        void ownerFile(
          session,
          `${base}/files/${encodeURIComponent(id)}`,
          m.assets_media_unavailable,
          {
            cache: "no-store",
            credentials: "omit",
            signal: controller.signal,
          },
        )
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            if (controller.signal.aborted) {
              URL.revokeObjectURL(url);
              return;
            }
            urls.push(url);
            setImages((current) => ({ ...current, [id]: url }));
          })
          .catch((failure: unknown) => {
            if (!controller.signal.aborted) setError(errorNotice(failure, m.api_visitor_file));
          });
    }
    return () => {
      controller.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [base, projection, session]);

  async function openFile(id: string) {
    try {
      const blob = await ownerFile(
        session,
        `${base}/files/${encodeURIComponent(id)}`,
        m.assets_document_unavailable,
        {
          cache: "no-store",
          credentials: "omit",
        },
      );
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      const extension =
        (
          {
            "application/pdf": ".pdf",
            "text/plain": ".txt",
            "image/jpeg": ".jpg",
            "image/png": ".png",
          } as Record<string, string>
        )[blob.type.split(";")[0]] ?? "";
      anchor.href = url;
      anchor.download = `${m.assets_shared_document_filename()}${extension}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setError(errorNotice(failure, m.api_visitor_file));
    }
  }

  async function openNavigation(id: string) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const target = await ownerRequest<unknown>(
        session,
        `${base}/navigation/${encodeURIComponent(id)}`,
        m.assets_navigation_unavailable,
        { cache: "no-store", credentials: "omit" },
      );
      const url = (target as { url?: unknown }).url;
      if (typeof url !== "string" || !url.startsWith("https://www.google.com/maps/dir/?"))
        throw new FeedbackError(() => m.assets_invalid_navigation());
      if (tab) tab.location.href = url;
      else setError(textNotice(() => m.assets_allow_popups_to_open_directions()));
    } catch (failure) {
      tab?.close();
      setError(errorNotice(failure, m.api_visitor_navigation));
    }
  }

  if (!isProjection(projection, audience))
    return <p role="alert">{m.assets_the_preview_could_not_be_displayed_safely()}</p>;
  return (
    <div className="rounded-xl border border-travel-card-border bg-travel-paper p-5">
      {error && <p role="alert">{error}</p>}
      <ProjectionView
        projection={projection}
        audience={audience}
        identifier=""
        previewResources={{
          images,
          openFile: (id) => void openFile(id),
          openNavigation: (id) => void openNavigation(id),
        }}
      />
    </div>
  );
}
