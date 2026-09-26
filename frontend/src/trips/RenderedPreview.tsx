import { useEffect, useState } from "react";

import type { TrackerSession } from "../auth";
import { ProjectionView, isProjection, type Audience, type Projection } from "../ProjectionView";
import { ownerFile, ownerRequest } from "../query/api";

export function RenderedPreview({ projection, audience, tripId, linkId, session }: {
  projection: Projection; audience: Audience; tripId: string; linkId?: string; session: TrackerSession;
}) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const base = `/api/trips/${encodeURIComponent(tripId)}/${audience === "public" ? "public-projection" : `share-links/${encodeURIComponent(linkId ?? "")}`}/preview`;

  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    setImages({});
    for (const item of projection.media) {
      const ids = [item.image, item.video, item.poster].flatMap((marker) => marker && typeof marker === "object" && typeof (marker as { id?: unknown }).id === "string" ? [(marker as { id: string }).id] : []);
      for (const id of ids) void ownerFile(session, `${base}/files/${encodeURIComponent(id)}`, "Media niet beschikbaar.", { cache: "no-store", credentials: "omit", signal: controller.signal }).then((blob) => {
        const url = URL.createObjectURL(blob);
        if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
        urls.push(url);
        setImages((current) => ({ ...current, [id]: url }));
      }).catch(() => { if (!controller.signal.aborted) setError("Een medium kon niet worden geladen."); });
    }
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [base, projection, session]);

  async function openFile(id: string) {
    try {
      const blob = await ownerFile(session, `${base}/files/${encodeURIComponent(id)}`, "Document niet beschikbaar.", { cache: "no-store", credentials: "omit" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      const extension = ({ "application/pdf": ".pdf", "text/plain": ".txt", "image/jpeg": ".jpg", "image/png": ".png" } as Record<string, string>)[blob.type.split(";")[0]] ?? "";
      anchor.href = url; anchor.download = `gedeeld-document${extension}`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError("Document niet beschikbaar."); }
  }

  async function openNavigation(id: string) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const target = await ownerRequest<unknown>(session, `${base}/navigation/${encodeURIComponent(id)}`, "Navigatie niet beschikbaar.", { cache: "no-store", credentials: "omit" });
      const url = (target as { url?: unknown }).url;
      if (typeof url !== "string" || !url.startsWith("https://www.google.com/maps/dir/?")) throw new Error("Ongeldige navigatie.");
      if (tab) tab.location.href = url;
      else setError("Sta pop-ups toe om de routebeschrijving te openen.");
    } catch { tab?.close(); setError("Navigatie niet beschikbaar."); }
  }

  if (!isProjection(projection, audience)) return <p role="alert">De preview kon niet veilig worden weergegeven.</p>;
  return <div className="rendered-preview">
    <header className="visitor-preview-header"><p className="eyebrow">Travel · Voorvertoning</p><h2>{projection.title || "Gedeelde reis"}</h2></header>
    {error && <p role="alert">{error}</p>}
    <ProjectionView projection={projection} audience={audience} identifier="" previewResources={{ images, openFile: (id) => void openFile(id), openNavigation: (id) => void openNavigation(id) }} />
  </div>;
}
