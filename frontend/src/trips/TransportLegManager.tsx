import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, browserTimeZone, daysBetween, localDate, localDateTime, timeZoneOptions, wallClock, type DocumentAsset, type TransportLeg, type Trip } from "../tracker-model";

const KIND_LABELS: Record<TransportLeg["kind"], string> = {
  flight: "Vlucht", train: "Trein", bus: "Bus", ferry: "Veerboot", car: "Auto", other: "Anders",
};

const STATUS_LABELS: Record<TransportLeg["status"], string> = {
  planned: "Gepland", booked: "Geboekt", confirmed: "Bevestigd", cancelled: "Geannuleerd",
};

/** "16 nov 10:40" in the endpoint's own zone (browser zone for older legs). */
function endpointTime(instant: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: timeZone ?? undefined, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(instant));
}

/** The archive's "+1 dag": calendar days between local departure and arrival. */
export function dayShift(leg: Pick<TransportLeg, "departs_at" | "arrives_at" | "departure_timezone" | "arrival_timezone">): number {
  return daysBetween(localDate(leg.departs_at, leg.departure_timezone), localDate(leg.arrives_at, leg.arrival_timezone));
}

function emptyDraft() {
  const zone = browserTimeZone();
  return {
    id: null as string | null,
    kind: "flight" as TransportLeg["kind"],
    status: "planned" as TransportLeg["status"],
    departsAt: localDateTime(),
    arrivesAt: localDateTime(new Date(Date.now() + 3_600_000)),
    departureTimezone: zone, arrivalTimezone: zone, travelClass: "",
    departureName: "", departureLocality: "", departureCountryCode: "", departurePlaceChanged: false,
    arrivalName: "", arrivalLocality: "", arrivalCountryCode: "", arrivalPlaceChanged: false,
    carrier: "", serviceReference: "", bookingReference: "", notes: "",
    documentAssetIds: [] as string[],
  };
}

export function TransportLegManager({ trip, onChange }: { trip: Trip; onChange?: () => void }) {
  const { session } = useAuth();
  const [legs, setLegs] = useState<TransportLeg[]>([]);
  const [documents, setDocuments] = useState<DocumentAsset[]>([]);
  const [message, setMessage] = useState("Laad je private transportonderdelen…");
  const [draft, setDraft] = useState(emptyDraft());

  async function load() {
    if (!session) return;
    const [legsResponse, documentsResponse] = await Promise.all([
      fetch(`/api/trips/${trip.id}/transport-legs`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/documents`, { headers: apiHeaders(session) }),
    ]);
    if (!legsResponse.ok) return apiError(legsResponse, "Je transportonderdelen konden niet worden geladen.");
    if (!documentsResponse.ok) return apiError(documentsResponse, "Je documenten konden niet worden geladen.");
    setLegs(await legsResponse.json() as TransportLeg[]);
    setDocuments(await documentsResponse.json() as DocumentAsset[]);
    setMessage("Vluchten en ander vervoer blijven private details tot je bewust een aparte etappe of route deelt.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je transportonderdelen konden niet worden geladen.")); }, [session, trip.id]);

  function newLeg() { setDraft(emptyDraft()); }

  function editLeg(leg: TransportLeg) {
    setDraft({
      id: leg.id, kind: leg.kind, status: leg.status,
      departsAt: wallClock(leg.departs_at, leg.departure_timezone), arrivesAt: wallClock(leg.arrives_at, leg.arrival_timezone),
      departureTimezone: leg.departure_timezone ?? browserTimeZone(), arrivalTimezone: leg.arrival_timezone ?? browserTimeZone(), travelClass: leg.travel_class ?? "",
      departureName: leg.departure_place.display_name ?? "", departureLocality: leg.departure_place.locality ?? "", departureCountryCode: leg.departure_place.country_code ?? "", departurePlaceChanged: false,
      arrivalName: leg.arrival_place.display_name ?? "", arrivalLocality: leg.arrival_place.locality ?? "", arrivalCountryCode: leg.arrival_place.country_code ?? "", arrivalPlaceChanged: false,
      carrier: leg.carrier ?? "", serviceReference: leg.service_reference ?? "", bookingReference: leg.booking_reference ?? "", notes: leg.notes ?? "",
      documentAssetIds: leg.document_asset_ids,
    });
  }

  function toggleDocument(documentId: string) {
    setDraft((current) => ({ ...current, documentAssetIds: current.documentAssetIds.includes(documentId) ? current.documentAssetIds.filter((id) => id !== documentId) : [...current.documentAssetIds, documentId] }));
  }

  async function saveLeg(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const payload = {
      kind: draft.kind,
      status: draft.status,
      // Local wall-clock times; the server resolves them in each endpoint's zone.
      departs_at: `${draft.departsAt}:00`,
      arrives_at: `${draft.arrivesAt}:00`,
      departure_timezone: draft.departureTimezone,
      arrival_timezone: draft.arrivalTimezone,
      carrier: draft.carrier.trim() || null,
      service_reference: draft.serviceReference.trim() || null,
      travel_class: draft.travelClass.trim() || null,
      booking_reference: draft.bookingReference.trim() || null,
      notes: draft.notes.trim() || null,
      document_asset_ids: draft.documentAssetIds,
      ...(!draft.id || draft.departurePlaceChanged ? { departure_place: { display_name: draft.departureName.trim() || null, locality: draft.departureLocality.trim() || null, country_code: draft.departureCountryCode.trim().toUpperCase() || null } } : {}),
      ...(!draft.id || draft.arrivalPlaceChanged ? { arrival_place: { display_name: draft.arrivalName.trim() || null, locality: draft.arrivalLocality.trim() || null, country_code: draft.arrivalCountryCode.trim().toUpperCase() || null } } : {}),
    };
    const response = await fetch(draft.id ? `/api/trips/${trip.id}/transport-legs/${draft.id}` : `/api/trips/${trip.id}/transport-legs`, { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "Het transportonderdeel kon niet worden opgeslagen.");
    await load();
    onChange?.();
    newLeg();
    setMessage("Privétransport opgeslagen.");
  }

  async function deleteLeg(leg: TransportLeg) {
    if (!session || !window.confirm(`Verwijder ${KIND_LABELS[leg.kind].toLowerCase()} “${leg.departure_place.locality ?? leg.departure_place.display_name ?? "?"} → ${leg.arrival_place.locality ?? leg.arrival_place.display_name ?? "?"}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/transport-legs/${leg.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het transportonderdeel kon niet worden verwijderd.");
    await load(); onChange?.(); newLeg(); setMessage("Privétransport verwijderd.");
  }

  return <section className="card manager" aria-labelledby="transport-title">
    <div className="capture-heading"><div><h3 id="transport-title">Vluchten &amp; ander vervoer</h3><p>Vluchtnummers, exacte tijden en boekingsreferenties zijn uitsluitend privé. Een gedeelde etappe blijft een aparte, bewust geschreven route-stap.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newLeg}>Nieuw onderdeel</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveLeg(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het transportonderdeel kon niet worden opgeslagen."))}>
      <div className="field-row">
        <label>Type<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as TransportLeg["kind"] }))}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Status<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as TransportLeg["status"] }))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <datalist id="transport-time-zones">{timeZoneOptions().map((zone) => <option key={zone} value={zone} />)}</datalist>
      <div className="field-row"><label>Vertrektijd (lokaal)<input required type="datetime-local" value={draft.departsAt} onChange={(event) => setDraft((current) => ({ ...current, departsAt: event.target.value }))} /></label><label>Tijdzone vertrek<input required list="transport-time-zones" maxLength={64} value={draft.departureTimezone} onChange={(event) => setDraft((current) => ({ ...current, departureTimezone: event.target.value }))} placeholder="Europe/Amsterdam" /></label></div>
      <div className="field-row"><label>Aankomsttijd (lokaal)<input required type="datetime-local" value={draft.arrivesAt} onChange={(event) => setDraft((current) => ({ ...current, arrivesAt: event.target.value }))} /></label><label>Tijdzone aankomst<input required list="transport-time-zones" maxLength={64} value={draft.arrivalTimezone} onChange={(event) => setDraft((current) => ({ ...current, arrivalTimezone: event.target.value }))} placeholder="Asia/Taipei" /></label></div>
      <fieldset><legend>Vertrekplaats</legend>
        <div className="field-row"><label>Naam <span className="optional">(optioneel)</span><input maxLength={500} value={draft.departureName} onChange={(event) => setDraft((current) => ({ ...current, departureName: event.target.value, departurePlaceChanged: true }))} placeholder="Bijvoorbeeld: Brussels Airport" /></label><label>Plaats <span className="optional">(optioneel)</span><input maxLength={120} value={draft.departureLocality} onChange={(event) => setDraft((current) => ({ ...current, departureLocality: event.target.value, departurePlaceChanged: true }))} /></label></div>
        <label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={draft.departureCountryCode} onChange={(event) => setDraft((current) => ({ ...current, departureCountryCode: event.target.value, departurePlaceChanged: true }))} placeholder="BE" /></label>
      </fieldset>
      <fieldset><legend>Aankomstplaats</legend>
        <div className="field-row"><label>Naam <span className="optional">(optioneel)</span><input maxLength={500} value={draft.arrivalName} onChange={(event) => setDraft((current) => ({ ...current, arrivalName: event.target.value, arrivalPlaceChanged: true }))} placeholder="Bijvoorbeeld: Taoyuan Airport" /></label><label>Plaats <span className="optional">(optioneel)</span><input maxLength={120} value={draft.arrivalLocality} onChange={(event) => setDraft((current) => ({ ...current, arrivalLocality: event.target.value, arrivalPlaceChanged: true }))} /></label></div>
        <label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={draft.arrivalCountryCode} onChange={(event) => setDraft((current) => ({ ...current, arrivalCountryCode: event.target.value, arrivalPlaceChanged: true }))} placeholder="TW" /></label>
      </fieldset>
      <div className="field-row"><label>Vervoerder <span className="optional">(optioneel)</span><input maxLength={160} value={draft.carrier} onChange={(event) => setDraft((current) => ({ ...current, carrier: event.target.value }))} placeholder="Bijvoorbeeld: EVA Air" /></label><label>Vlucht-/dienstnummer <span className="optional">(optioneel)</span><input maxLength={40} value={draft.serviceReference} onChange={(event) => setDraft((current) => ({ ...current, serviceReference: event.target.value }))} placeholder="BR-087" /></label></div>
      <label>Reisklasse <span className="optional">(optioneel)</span><input maxLength={80} value={draft.travelClass} onChange={(event) => setDraft((current) => ({ ...current, travelClass: event.target.value }))} placeholder="Bijvoorbeeld: Premium Economy" /></label>
      <label>Boekingsreferentie <span className="optional">(optioneel)</span><input maxLength={255} value={draft.bookingReference} onChange={(event) => setDraft((current) => ({ ...current, bookingReference: event.target.value }))} /></label>
      <label>Notities <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      {documents.length > 0 && <fieldset><legend>Gekoppelde documenten <span className="optional">(optioneel)</span></legend>{documents.map((document) => <label className="media-choice" key={document.id}><input type="checkbox" checked={draft.documentAssetIds.includes(document.id)} onChange={() => toggleDocument(document.id)} />{document.title}</label>)}</fieldset>}
      <button type="submit">{draft.id ? "Onderdeel opslaan" : "Onderdeel toevoegen"}</button>
    </form>
    {legs.length > 0 && <div className="saved-moments manager-list">{legs.map((leg) => <article className="excerpt-row" key={leg.id}><div><strong>{KIND_LABELS[leg.kind]}: {leg.departure_place.locality ?? leg.departure_place.display_name ?? "?"} → {leg.arrival_place.locality ?? leg.arrival_place.display_name ?? "?"}</strong><span>{endpointTime(leg.departs_at, leg.departure_timezone)} → {endpointTime(leg.arrives_at, leg.arrival_timezone)}{dayShift(leg) !== 0 ? ` (${dayShift(leg) > 0 ? "+" : ""}${dayShift(leg)} ${Math.abs(dayShift(leg)) === 1 ? "dag" : "dagen"})` : ""} · {STATUS_LABELS[leg.status]}{leg.carrier ? ` · ${leg.carrier}` : ""}{leg.service_reference ? ` ${leg.service_reference}` : ""}{leg.travel_class ? ` · ${leg.travel_class}` : ""}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editLeg(leg)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteLeg(leg).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het transportonderdeel kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
  </section>;
}
