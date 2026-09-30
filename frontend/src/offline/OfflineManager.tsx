import { errorNotice, useFeedback } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { useConfirmation } from "../forms/useConfirmation";
import { bytesLabel, formatInstant, openBlobInNewTab } from "../tracker-model";
import { useOfflineCopies } from "./useOfflineCopies";
import type { OfflineCopySummary, OfflineResourceKind } from "./offline-store";
import { PackingOfflineView } from "../trips/PackingOfflineView";

const KIND_LABELS: Record<OfflineResourceKind, string> = {
  library_document: "Bibliotheekdocument",
  trip_document: "Reisdocument",
  emergency_info: "Noodinformatie",
  media_asset: "Privémedia",
  media_derivative: "Afgeleide media",
  route_data: "Kaart- en routegegevens",
  visit: "Bezoek",
  packing_list: "Paklijst",
};

const formatMoment = formatInstant;

export function OfflineManager() {
  const confirmation = useConfirmation();
  const offline = useOfflineCopies();
  const [message, setMessage] = useFeedback<string>("");
  const [viewingText, setViewingText] = useState<{ title: string; text: string } | null>(null);
  const [viewingPacking, setViewingPacking] = useState<OfflineCopySummary | null>(null);

  if (!offline.subject) return null;

  async function view(copy: OfflineCopySummary) {
    setMessage("");
    if (copy.resourceKind === "packing_list") {
      setViewingPacking(copy);
      return;
    }
    try {
      const blob = await offline.open(copy.id);
      if (copy.contentType === "application/json") {
        setViewingText({ title: copy.title, text: await blob.text() });
        return;
      }
      openBlobInNewTab(blob);
    } catch (error) {
      setMessage(errorNotice(error, "De offline kopie kon niet worden geopend."));
    }
  }

  function remove(copy: OfflineCopySummary) {
    confirmation.ask({
      title: `“${copy.title}” niet langer offline bewaren?`,
      description: "De kopie wordt van dit toestel verwijderd; het origineel blijft bewaard.",
      confirmLabel: "Niet meer bewaren",
      onConfirm: async () => {
        await offline.remove(copy.id);
        setMessage(`“${copy.title}” is niet langer offline beschikbaar.`);
      },
    });
  }

  function clearAll() {
    confirmation.ask({
      title: "Alle offline kopieën verwijderen?",
      description: "Dit wist alleen de kopieën op dit toestel.",
      confirmLabel: "Alles wissen",
      onConfirm: async () => {
        await offline.clearAll();
        setMessage("Alle offline kopieën op dit toestel zijn verwijderd.");
      },
    });
  }

  const totalBytes = offline.copies.reduce((sum, copy) => sum + copy.byteSize, 0);

  return (
    <section className="travel-card manager" aria-labelledby="offline-title">
      <div className="capture-heading">
        <div>
          <h3 id="offline-title">Offline</h3>
          <p>Bewust bewaarde kopieën blijven alleen op dit toestel en verdwijnen bij afmelden.</p>
        </div>
        {offline.copies.length > 0 && (
          <Button className="danger compact" type="button" onClick={clearAll}>
            Alles wissen
          </Button>
        )}
      </div>
      <p className="help" role="status">
        {message ||
          (offline.unsupported && "Offline opslag wordt niet ondersteund in deze browser.") ||
          (!offline.online && "Je bent offline. Kopieën worden opnieuw gecontroleerd zodra je weer verbinding hebt.") ||
          (offline.copies.length > 0
            ? `${offline.copies.length} offline kopie(ën) · ${bytesLabel(totalBytes)} op dit toestel.`
            : "Nog geen offline kopieën.")}
      </p>
      {offline.disclosure?.exportable && (
        <p className="help">
          Je browser kan de offline sleutel niet als niet-exporteerbaar bewaren; kopieën zijn best-effort versleuteld op
          dit toestel.
        </p>
      )}
      {offline.persisted === false && (
        <p className="help">
          Je browser heeft geen persistente opslag toegekend voor deze offline kopieën; ze kunnen automatisch worden
          opgeruimd bij weinig opslagruimte op dit toestel.
        </p>
      )}
      {!offline.copies.length && offline.loaded && (
        <p>
          Zet “Offline bewaren” aan bij een document, noodinformatie, medium, kaart, bezoek of paklijst om het hier te
          laten verschijnen.
        </p>
      )}
      {offline.copies.length > 0 && (
        <div className="saved-records mt-0.5">
          {offline.copies.map((copy) => (
            <article className="excerpt-row" key={copy.id}>
              <div>
                <strong>{copy.title}</strong>
                <span>
                  {KIND_LABELS[copy.resourceKind]} · {bytesLabel(copy.byteSize)} · laatst gecontroleerd{" "}
                  {formatMoment(copy.lastValidatedAt)} · geldig tot {formatMoment(copy.leaseExpiresAt)}
                </span>
              </div>
              <div className="button-row">
                <Button className="secondary compact" type="button" onClick={() => void view(copy)}>
                  Bekijken
                </Button>
                <Button className="danger compact" type="button" onClick={() => remove(copy)}>
                  Verwijderen
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {viewingText && (
        <div className="travel-card manager-subsection">
          <div className="capture-heading">
            <div>
              <h3>{viewingText.title}</h3>
            </div>
          </div>
          <pre>{viewingText.text}</pre>
          <Button className="secondary compact" type="button" onClick={() => setViewingText(null)}>
            Sluiten
          </Button>
        </div>
      )}
      {viewingPacking && offline.copies.some((copy) => copy.id === viewingPacking.id) && (
        <div className="rounded-xl border p-4">
          <PackingOfflineView copy={viewingPacking} open={offline.open} />
          <Button className="secondary compact mt-3" type="button" onClick={() => setViewingPacking(null)}>
            Sluiten
          </Button>
        </div>
      )}
      {confirmation.dialog}
    </section>
  );
}
