import { useEffect, useState } from "react";

import type { TrackerSession } from "../auth";
import { ProjectionView, isProjection, type Audience, type Projection } from "../ProjectionView";
import { apiHeaders } from "../tracker-model";

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
      if (!item.image || typeof item.image !== "object" || (item.image as { id?: unknown }).id !== item.id) continue;
      void fetch(`${base}/files/${encodeURIComponent(item.id)}`, {
        headers: apiHeaders(session), cache: "no-store", credentials: "omit", signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok) throw new Error("Afbeelding niet beschikbaar.");
        const url = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
        urls.push(url);
        setImages((current) => ({ ...current, [item.id]: url }));
      }).catch(() => { if (!controller.signal.aborted) setError("Een afbeelding kon niet worden geladen."); });
    }
    return () => { controller.abort(); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [base, projection, session]);

  async function openFile(id: string) {
    try {
      const response = await fetch(`${base}/files/${encodeURIComponent(id)}`, { headers: apiHeaders(session), cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Document niet beschikbaar.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = window.document.createElement("a");
      const extension = ({ "application/pdf": ".pdf", "text/plain": ".txt", "image/jpeg": ".jpg", "image/png": ".png" } as Record<string, string>)[response.headers.get("content-type")?.split(";")[0] ?? ""] ?? "";
      anchor.href = url; anchor.download = `gedeeld-document${extension}`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { setError("Document niet beschikbaar."); }
  }

  async function openNavigation(id: string) {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const response = await fetch(`${base}/navigation/${encodeURIComponent(id)}`, { headers: apiHeaders(session), cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Navigatie niet beschikbaar.");
      const target: unknown = await response.json();
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
