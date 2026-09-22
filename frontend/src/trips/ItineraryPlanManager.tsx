import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, type DocumentAsset, type ItineraryEntry, type ItineraryLinkKind, type Place, type Stay, type TransportLeg, type Trip } from "../tracker-model";

const LINK_LABELS: Record<ItineraryLinkKind, string> = {
  stay: "Verblijf", transport_leg: "Vervoer", route_stage: "Route-etappe", place: "Exacte plaats", document: "Document", moment: "Moment",
};

const LINK_ANCHORS: Record<ItineraryLinkKind, string | null> = {
  stay: "#stays-title", transport_leg: "#transport-title", route_stage: "#route-stages-title", place: null, document: "#documents-title", moment: "#moments-title",
};

function emptyDraft() {
  return { id: null as string | null, dayDate: "", title: "", notes: "", linkedKind: "" as ItineraryLinkKind | "", linkedId: "" };
}

export function ItineraryPlanManager({ trip }: { trip: Trip }) {
  const { session } = useAuth();
  const [entries, setEntries] = useState<ItineraryEntry[]>([]);
  const [stays, setStays] = useState<Stay[]>([]);
  const [legs, setLegs] = useState<TransportLeg[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [documents, setDocuments] = useState<DocumentAsset[]>([]);
  const [message, setMessage] = useState("Laad je private dagplanning…");
  const [draft, setDraft] = useState(emptyDraft());

  async function load() {
    if (!session) return;
    const [entriesResponse, staysResponse, legsResponse, placesResponse, documentsResponse] = await Promise.all([
      fetch(`/api/trips/${trip.id}/itinerary-entries`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/stays`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/transport-legs`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/places`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/documents`, { headers: apiHeaders(session) }),
    ]);
    if (!entriesResponse.ok) return apiError(entriesResponse, "Je dagplanning kon niet worden geladen.");
    if (!staysResponse.ok) return apiError(staysResponse, "Je verblijven konden niet worden geladen.");
    if (!legsResponse.ok) return apiError(legsResponse, "Je transportonderdelen konden niet worden geladen.");
    if (!placesResponse.ok) return apiError(placesResponse, "Je exacte plaatsen konden niet worden geladen.");
    if (!documentsResponse.ok) return apiError(documentsResponse, "Je documenten konden niet worden geladen.");
    setEntries((await entriesResponse.json() as ItineraryEntry[]).slice().sort((left, right) => left.position - right.position));
    setStays(await staysResponse.json() as Stay[]);
    setLegs(await legsResponse.json() as TransportLeg[]);
    setPlaces(await placesResponse.json() as Place[]);
    setDocuments(await documentsResponse.json() as DocumentAsset[]);
    setMessage("De dagplanning is een private navigatiehulp; ze verwijst alleen naar reeds bestaande onderdelen.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je dagplanning kon niet worden geladen.")); }, [session, trip.id]);

  function linkOptions(kind: ItineraryLinkKind): { id: string; label: string }[] {
    if (kind === "stay") return stays.map((stay) => ({ id: stay.id, label: `${stay.property_name} · ${stay.place.locality ?? stay.place.display_name ?? "?"}` }));
    if (kind === "transport_leg") return legs.map((leg) => ({ id: leg.id, label: `${leg.departure_place.locality ?? leg.departure_place.display_name ?? "?"} → ${leg.arrival_place.locality ?? leg.arrival_place.display_name ?? "?"}` }));
    if (kind === "route_stage") return trip.route_stages.map((stage) => ({ id: stage.id, label: stage.label ?? stage.place.label }));
    if (kind === "place") return places.map((place) => ({ id: place.id, label: place.display_name ?? place.locality ?? place.id }));
    if (kind === "document") return documents.map((document) => ({ id: document.id, label: document.title }));
    return trip.moments.map((moment) => ({ id: moment.id, label: moment.title }));
  }

  function resolveLink(entry: ItineraryEntry): { label: string; anchor: string | null } | null {
    if (!entry.linked_kind || !entry.linked_id) return null;
    const option = linkOptions(entry.linked_kind).find((candidate) => candidate.id === entry.linked_id);
    return { label: option ? `${LINK_LABELS[entry.linked_kind]}: ${option.label}` : `${LINK_LABELS[entry.linked_kind]} (verwijderd)`, anchor: option ? LINK_ANCHORS[entry.linked_kind] : null };
  }

  function newEntry() { setDraft(emptyDraft()); }

  function editEntry(entry: ItineraryEntry) {
    setDraft({ id: entry.id, dayDate: entry.day_date ?? "", title: entry.title, notes: entry.notes ?? "", linkedKind: entry.linked_kind ?? "", linkedId: entry.linked_id ?? "" });
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (draft.linkedKind && !draft.linkedId) { setMessage("Kies een gekoppeld onderdeel of laat het gekoppelde type leeg."); return; }
    const payload = {
      day_date: draft.dayDate || null,
      title: draft.title.trim(),
      notes: draft.notes.trim() || null,
      linked_kind: draft.linkedKind || null,
      linked_id: draft.linkedKind ? draft.linkedId : null,
      ...(draft.id ? {} : { position: entries.length }),
    };
    const response = await fetch(draft.id ? `/api/trips/${trip.id}/itinerary-entries/${draft.id}` : `/api/trips/${trip.id}/itinerary-entries`, { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "De planningsstap kon niet worden opgeslagen.");
    await load();
    newEntry();
    setMessage("Planningsstap opgeslagen.");
  }

  async function moveEntry(entry: ItineraryEntry, direction: -1 | 1) {
    if (!session) return;
    const nextPosition = entry.position + direction;
    if (nextPosition < 0 || nextPosition >= entries.length) return;
    const response = await fetch(`/api/trips/${trip.id}/itinerary-entries/${entry.id}`, { method: "PATCH", headers: apiHeaders(session), body: JSON.stringify({ position: nextPosition }) });
    if (!response.ok) return apiError(response, "De planningsstap kon niet worden verplaatst.");
    await load();
    setMessage("Volgorde van de dagplanning opgeslagen.");
  }

  async function deleteEntry(entry: ItineraryEntry) {
    if (!session || !window.confirm(`Verwijder planningsstap “${entry.title}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/itinerary-entries/${entry.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De planningsstap kon niet worden verwijderd.");
    await load();
    newEntry();
    setMessage("Planningsstap verwijderd.");
  }

  return <section className="card manager" aria-labelledby="itinerary-title">
    <div className="capture-heading"><div><h3 id="itinerary-title">Dagplanning</h3><p>Een concept-planning die verwijst naar bestaande onderdelen. Ze blijft privé en kopieert nooit hun details.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newEntry}>Nieuwe stap</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveEntry(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden opgeslagen."))}>
      <div className="field-row">
        <label>Dag <span className="optional">(optioneel)</span><input type="date" value={draft.dayDate} onChange={(event) => setDraft((current) => ({ ...current, dayDate: event.target.value }))} /></label>
        <label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: Aankomst Taipei" /></label>
      </div>
      <label>Notities <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      <div className="field-row">
        <label>Gekoppeld type <span className="optional">(optioneel)</span><select value={draft.linkedKind} onChange={(event) => setDraft((current) => ({ ...current, linkedKind: event.target.value as ItineraryLinkKind | "", linkedId: "" }))}><option value="">Geen koppeling</option>{Object.entries(LINK_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {draft.linkedKind && <label>Gekoppeld onderdeel<select required value={draft.linkedId} onChange={(event) => setDraft((current) => ({ ...current, linkedId: event.target.value }))}><option value="">Kies een onderdeel</option>{linkOptions(draft.linkedKind).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
      </div>
      <button type="submit">{draft.id ? "Stap opslaan" : "Stap toevoegen"}</button>
    </form>
    {entries.length > 0 && <div className="saved-moments manager-list">{entries.map((entry, index) => {
      const link = resolveLink(entry);
      return <article className="excerpt-row" key={entry.id}>
        <div><strong>{entry.title}</strong><span>{entry.day_date ?? "Nog geen dag"}{entry.notes ? ` · ${entry.notes}` : ""}</span>{link && <span>{link.anchor ? <a href={link.anchor}>{link.label}</a> : link.label}</span>}</div>
        <div className="button-row">
          <button className="secondary compact" type="button" disabled={index === 0} onClick={() => void moveEntry(entry, -1).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden verplaatst."))}>Omhoog</button>
          <button className="secondary compact" type="button" disabled={index === entries.length - 1} onClick={() => void moveEntry(entry, 1).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden verplaatst."))}>Omlaag</button>
          <button className="secondary compact" type="button" onClick={() => editEntry(entry)}>Bewerken</button>
          <button className="danger compact" type="button" onClick={() => void deleteEntry(entry).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden verwijderd."))}>Verwijderen</button>
        </div>
      </article>;
    })}</div>}
  </section>;
}
