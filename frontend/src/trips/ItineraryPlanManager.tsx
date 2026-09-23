import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { addDays, apiError, apiHeaders, formatDayRange, stayCoversNight, stayLabel, type DocumentAsset, type ItineraryEntry, type ItineraryEntryKind, type ItineraryLinkKind, type Place, type Stay, type TransportLeg, type Trip } from "../tracker-model";

const KIND_LABELS: Record<ItineraryEntryKind, string> = { travel: "Reis", free: "Vrij", work: "Werk" };

type TripDates = Pick<Trip, "starts_on" | "ends_on">;

/** Every trip night an entry spans: none before departure, none on the final day. */
function entryNights(entry: ItineraryEntry, trip: TripDates): string[] {
  if (!entry.day_date) return [];
  const nights: string[] = [];
  for (let night = entry.day_date; night <= (entry.end_date ?? entry.day_date) && nights.length < 60; night = addDays(night, 1)) {
    if ((!trip.starts_on || night >= trip.starts_on) && (!trip.ends_on || night < trip.ends_on)) nights.push(night);
  }
  return nights;
}

/** Which stays the owner sleeps at during an entry, and how many nights lack one. */
export function overnights(entry: ItineraryEntry, stays: Stay[], trip: TripDates): { stays: Stay[]; uncovered: number } {
  const nights = entryNights(entry, trip);
  const covering = stays.filter((stay) => nights.some((night) => stayCoversNight(stay, night)));
  return { stays: covering, uncovered: nights.filter((night) => !stays.some((stay) => stayCoversNight(stay, night))).length };
}

const LINK_LABELS: Record<ItineraryLinkKind, string> = {
  stay: "Verblijf", transport_leg: "Vervoer", route_stage: "Route-etappe", place: "Exacte plaats", document: "Document", moment: "Moment",
};

const LINK_ANCHORS: Record<ItineraryLinkKind, string | null> = {
  stay: "#stays-title", transport_leg: "#transport-title", route_stage: "#route-stages-title", place: null, document: "#documents-title", moment: "#moments-title",
};

function emptyDraft() {
  return { id: null as string | null, dayDate: "", endDate: "", kind: "" as ItineraryEntryKind | "", tentative: false, title: "", notes: "", linkedKind: "" as ItineraryLinkKind | "", linkedId: "" };
}

export function ItineraryPlanManager({ trip, revision = 0, onShowOnMap }: { trip: Trip; revision?: number; onShowOnMap?: (pointId: string) => void }) {
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

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je dagplanning kon niet worden geladen.")); }, [session, trip.id, revision]);

  function linkOptions(kind: ItineraryLinkKind): { id: string; label: string }[] {
    if (kind === "stay") return stays.map((stay) => ({ id: stay.id, label: `${stayLabel(stay)} · ${formatDayRange(stay.check_in_date, addDays(stay.check_out_date, -1))}` }));
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

  /** The map point for an entry's link: a stage's broad place or an exact place. */
  function mapPointFor(entry: ItineraryEntry): string | null {
    if (entry.linked_kind === "route_stage") return trip.route_stages.find((stage) => stage.id === entry.linked_id)?.place.id ?? null;
    if (entry.linked_kind === "place") return entry.linked_id;
    if (entry.linked_kind === "stay") {
      const stay = stays.find((candidate) => candidate.id === entry.linked_id);
      return stay?.place?.latitude != null ? stay.place.id : stay?.broad_place?.id ?? null;
    }
    if (entry.linked_kind === "transport_leg") return legs.find((leg) => leg.id === entry.linked_id)?.arrival_place.id ?? null;
    return null;
  }

  function newEntry() { setDraft(emptyDraft()); }

  function editEntry(entry: ItineraryEntry) {
    setDraft({ id: entry.id, dayDate: entry.day_date ?? "", endDate: entry.end_date ?? "", kind: entry.kind ?? "", tentative: entry.tentative, title: entry.title, notes: entry.notes ?? "", linkedKind: entry.linked_kind ?? "", linkedId: entry.linked_id ?? "" });
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (draft.linkedKind && !draft.linkedId) { setMessage("Kies een gekoppeld onderdeel of laat het gekoppelde type leeg."); return; }
    if (draft.endDate && (!draft.dayDate || draft.endDate < draft.dayDate)) { setMessage("De laatste dag volgt op de eerste dag."); return; }
    const payload = {
      day_date: draft.dayDate || null,
      end_date: draft.endDate && draft.endDate !== draft.dayDate ? draft.endDate : null,
      kind: draft.kind || null,
      tentative: draft.tentative,
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
        <label>Eerste dag <span className="optional">(optioneel)</span><input type="date" value={draft.dayDate} onChange={(event) => setDraft((current) => ({ ...current, dayDate: event.target.value }))} /></label>
        <label>Laatste dag <span className="optional">(optioneel)</span><input type="date" min={draft.dayDate || undefined} disabled={!draft.dayDate} value={draft.endDate} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))} /></label>
      </div>
      <label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: Aankomst Taipei" /></label>
      <div className="field-row">
        <label>Soort dag <span className="optional">(optioneel)</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as ItineraryEntryKind | "" }))}><option value="">Geen soort</option>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="media-choice"><input type="checkbox" checked={draft.tentative} onChange={(event) => setDraft((current) => ({ ...current, tentative: event.target.checked }))} />Concept — kan nog verschuiven</label>
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
      const mapPoint = onShowOnMap ? mapPointFor(entry) : null;
      const sleep = overnights(entry, stays, trip);
      const tags = [entry.kind ? KIND_LABELS[entry.kind] : null, entry.tentative ? "Concept" : null].filter(Boolean).join(" · ");
      return <article className={`excerpt-row ${entry.tentative ? "tentative" : ""}`} key={entry.id}>
        <div><strong>{entry.title}</strong><span>{entry.day_date ? formatDayRange(entry.day_date, entry.end_date) : "Nog geen dag"}{tags ? ` · ${tags}` : ""}{entry.notes ? ` · ${entry.notes}` : ""}</span>{link && <span className="entry-detail">{link.anchor ? <a href={link.anchor}>{link.label}</a> : link.label}</span>}
          {(sleep.stays.length > 0 || sleep.uncovered > 0) && <span className="entry-detail">Overnachting: {sleep.stays.map(stayLabel).join(", ") || "—"}{sleep.uncovered > 0 ? ` · nog ${sleep.uncovered} ${sleep.uncovered === 1 ? "nacht" : "nachten"} zonder verblijf` : ""}</span>}</div>
        <div className="button-row">
          {mapPoint && <button className="secondary compact" type="button" onClick={() => onShowOnMap?.(mapPoint)}>Toon op kaart</button>}
          <button className="secondary compact" type="button" disabled={index === 0} onClick={() => void moveEntry(entry, -1).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden verplaatst."))}>Omhoog</button>
          <button className="secondary compact" type="button" disabled={index === entries.length - 1} onClick={() => void moveEntry(entry, 1).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden verplaatst."))}>Omlaag</button>
          <button className="secondary compact" type="button" onClick={() => editEntry(entry)}>Bewerken</button>
          <button className="danger compact" type="button" onClick={() => void deleteEntry(entry).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De planningsstap kon niet worden verwijderd."))}>Verwijderen</button>
        </div>
      </article>;
    })}</div>}
  </section>;
}
