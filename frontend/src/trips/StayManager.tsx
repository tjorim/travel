import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { addDays, apiError, apiHeaders, daysBetween, formatDay, stayLabel, type BroadPlace, type BroadStayCard, type Stay, type Trip } from "../tracker-model";

const STATUS_LABELS: Record<Stay["status"], string> = { planned: "Gepland", booked: "Geboekt", confirmed: "Bevestigd", cancelled: "Geannuleerd" };

/** The archive's hotel states: still choosing, proposed, booked. */
export function stayStateLabel(stay: Stay): string {
  if (stay.status === "planned") return stay.property_name ? "Voorgesteld" : "Nog kiezen";
  return STATUS_LABELS[stay.status];
}

function emptyStayDraft(trip: Trip) {
  const checkIn = trip.starts_on ?? new Date().toISOString().slice(0, 10);
  return { id: null as string | null, broadPlaceId: "", propertyName: "", checkInDate: checkIn, checkOutDate: addDays(checkIn, 1), checkInTime: "", checkOutTime: "", status: "planned" as Stay["status"], websiteUrl: "", address: "", locality: "", countryCode: "", placeChanged: false, bookingReference: "", contactDetails: "", notes: "" };
}

export function StayManager({ trip, broadPlaces, onChange }: { trip: Trip; broadPlaces: BroadPlace[]; onChange?: () => void }) {
  const { session } = useAuth();
  const [stays, setStays] = useState<Stay[]>([]);
  const [cards, setCards] = useState<BroadStayCard[]>([]);
  const [message, setMessage] = useState("Laad je private verblijven…");
  const [stayDraft, setStayDraft] = useState(() => emptyStayDraft(trip));
  const [cardDraft, setCardDraft] = useState({ id: null as string | null, broadPlaceId: "", title: "", datePrecision: "month" as BroadStayCard["date_precision"] });

  async function load() {
    if (!session) return;
    const [staysResponse, cardsResponse] = await Promise.all([
      fetch(`/api/trips/${trip.id}/stays`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/broad-stay-cards`, { headers: apiHeaders(session) }),
    ]);
    if (!staysResponse.ok) return apiError(staysResponse, "Je verblijven konden niet worden geladen.");
    if (!cardsResponse.ok) return apiError(cardsResponse, "Je brede verblijfskaarten konden niet worden geladen.");
    setStays(await staysResponse.json() as Stay[]);
    setCards(await cardsResponse.json() as BroadStayCard[]);
    setMessage("Verblijven blijven private details. Brede kaarten worden altijd afzonderlijk geschreven.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je verblijven konden niet worden geladen.")); }, [session, trip.id]);

  function newStay() {
    setStayDraft(emptyStayDraft(trip));
  }

  function editStay(stay: Stay) {
    setStayDraft({ id: stay.id, broadPlaceId: stay.broad_place?.id ?? "", propertyName: stay.property_name ?? "", checkInDate: stay.check_in_date, checkOutDate: stay.check_out_date, checkInTime: stay.check_in_time?.slice(0, 5) ?? "", checkOutTime: stay.check_out_time?.slice(0, 5) ?? "", status: stay.status, websiteUrl: stay.website_url ?? "", address: stay.place?.address_line1 ?? "", locality: stay.place?.locality ?? "", countryCode: stay.place?.country_code ?? "", placeChanged: false, bookingReference: stay.booking_reference ?? "", contactDetails: stay.contact_details ?? "", notes: stay.notes ?? "" });
  }

  async function saveStay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (stayDraft.checkOutDate <= stayDraft.checkInDate) throw new Error("Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht.");
    const propertyName = stayDraft.propertyName.trim();
    const hasPlace = Boolean(propertyName || stayDraft.address.trim() || stayDraft.locality.trim() || stayDraft.countryCode.trim());
    const payload = {
      broad_place_id: stayDraft.broadPlaceId || null,
      property_name: propertyName || null,
      check_in_date: stayDraft.checkInDate,
      check_out_date: stayDraft.checkOutDate,
      check_in_time: stayDraft.checkInTime || null,
      check_out_time: stayDraft.checkOutTime || null,
      status: stayDraft.status,
      website_url: stayDraft.websiteUrl.trim() || null,
      booking_reference: stayDraft.bookingReference.trim() || null,
      contact_details: stayDraft.contactDetails.trim() || null,
      notes: stayDraft.notes.trim() || null,
      ...(!stayDraft.id || stayDraft.placeChanged ? { place: hasPlace ? { display_name: propertyName || null, address_line1: stayDraft.address.trim() || null, locality: stayDraft.locality.trim() || null, country_code: stayDraft.countryCode.trim().toUpperCase() || null } : null } : {}),
    };
    const response = await fetch(stayDraft.id ? `/api/trips/${trip.id}/stays/${stayDraft.id}` : `/api/trips/${trip.id}/stays`, { method: stayDraft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "Het verblijf kon niet worden opgeslagen.");
    await load();
    onChange?.();
    newStay();
    setMessage("Privéverblijf opgeslagen.");
  }

  async function deleteStay(stay: Stay) {
    if (!session || !window.confirm(`Verwijder verblijf “${stayLabel(stay)}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/stays/${stay.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het verblijf kon niet worden verwijderd.");
    await load(); onChange?.(); newStay(); setMessage("Privéverblijf verwijderd.");
  }

  function newCard() { setCardDraft({ id: null, broadPlaceId: "", title: "", datePrecision: "month" }); }
  function editCard(card: BroadStayCard) { setCardDraft({ id: card.id, broadPlaceId: card.place.id, title: card.title, datePrecision: card.date_precision }); }

  async function saveCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const response = await fetch(cardDraft.id ? `/api/trips/${trip.id}/broad-stay-cards/${cardDraft.id}` : `/api/trips/${trip.id}/broad-stay-cards`, { method: cardDraft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify({ broad_place_id: cardDraft.broadPlaceId, title: cardDraft.title.trim(), date_precision: cardDraft.datePrecision }) });
    if (!response.ok) return apiError(response, "De brede verblijfskaart kon niet worden opgeslagen.");
    await load(); newCard(); setMessage("Brede verblijfskaart opgeslagen. Hij is nog niet gedeeld.");
  }

  async function deleteCard(card: BroadStayCard) {
    if (!session || !window.confirm(`Verwijder brede kaart “${card.title}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/broad-stay-cards/${card.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De brede verblijfskaart kon niet worden verwijderd.");
    await load(); newCard(); setMessage("Brede verblijfskaart verwijderd.");
  }

  return <section className="card manager" aria-labelledby="stays-title">
    <div className="capture-heading"><div><h3 id="stays-title">Verblijven</h3><p>Een verblijf is een reeks nachten: inchecken de namiddag van de eerste nacht, uitchecken de ochtend erna. Adressen, boekingen en contactgegevens zijn uitsluitend privé.</p></div>{stayDraft.id && <button className="secondary compact" type="button" onClick={newStay}>Nieuw verblijf</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveStay(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het verblijf kon niet worden opgeslagen."))}>
      <div className="field-row"><label>Stad of gebied <span className="optional">(optioneel)</span><select value={stayDraft.broadPlaceId} onChange={(event) => setStayDraft((draft) => ({ ...draft, broadPlaceId: event.target.value }))}><option value="">Geen brede plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label><label>Status<select value={stayDraft.status} onChange={(event) => setStayDraft((draft) => ({ ...draft, status: event.target.value as Stay["status"] }))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <label>Accommodatie <span className="optional">(leeg zolang je nog kiest)</span><input maxLength={160} value={stayDraft.propertyName} onChange={(event) => setStayDraft((draft) => ({ ...draft, propertyName: event.target.value, placeChanged: true }))} /></label>
      <div className="field-row"><label>Eerste nacht (inchecken)<input required type="date" value={stayDraft.checkInDate} onChange={(event) => setStayDraft((draft) => ({ ...draft, checkInDate: event.target.value, checkOutDate: draft.checkOutDate > event.target.value ? draft.checkOutDate : addDays(event.target.value, 1) }))} /></label><label>Uitchecken (ochtend)<input required type="date" min={addDays(stayDraft.checkInDate, 1)} value={stayDraft.checkOutDate} onChange={(event) => setStayDraft((draft) => ({ ...draft, checkOutDate: event.target.value }))} /></label></div>
      <p className="help">{daysBetween(stayDraft.checkInDate, stayDraft.checkOutDate) > 0 ? `${daysBetween(stayDraft.checkInDate, stayDraft.checkOutDate)} ${daysBetween(stayDraft.checkInDate, stayDraft.checkOutDate) === 1 ? "nacht" : "nachten"}` : "Kies een uitcheckdatum na de eerste nacht."} · lokale datums bij het verblijf</p>
      <div className="field-row"><label>Inchecktijd <span className="optional">(optioneel)</span><input type="time" value={stayDraft.checkInTime} onChange={(event) => setStayDraft((draft) => ({ ...draft, checkInTime: event.target.value }))} /></label><label>Uitchecktijd <span className="optional">(optioneel)</span><input type="time" value={stayDraft.checkOutTime} onChange={(event) => setStayDraft((draft) => ({ ...draft, checkOutTime: event.target.value }))} /></label></div>
      <div className="field-row"><label>Adres <span className="optional">(optioneel)</span><input maxLength={160} value={stayDraft.address} onChange={(event) => setStayDraft((draft) => ({ ...draft, address: event.target.value, placeChanged: true }))} /></label><label>Plaats <span className="optional">(optioneel)</span><input maxLength={120} value={stayDraft.locality} onChange={(event) => setStayDraft((draft) => ({ ...draft, locality: event.target.value, placeChanged: true }))} /></label></div>
      <div className="field-row"><label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={stayDraft.countryCode} onChange={(event) => setStayDraft((draft) => ({ ...draft, countryCode: event.target.value, placeChanged: true }))} placeholder="TW" /></label><label>Website <span className="optional">(optioneel, https)</span><input type="url" pattern="https://.*" maxLength={2048} value={stayDraft.websiteUrl} onChange={(event) => setStayDraft((draft) => ({ ...draft, websiteUrl: event.target.value }))} placeholder="https://" /></label></div>
      <label>Boekingsreferentie <span className="optional">(optioneel)</span><input maxLength={255} value={stayDraft.bookingReference} onChange={(event) => setStayDraft((draft) => ({ ...draft, bookingReference: event.target.value }))} /></label><label>Contactgegevens <span className="optional">(optioneel)</span><textarea maxLength={2000} rows={3} value={stayDraft.contactDetails} onChange={(event) => setStayDraft((draft) => ({ ...draft, contactDetails: event.target.value }))} /></label><label>Notities <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={3} value={stayDraft.notes} onChange={(event) => setStayDraft((draft) => ({ ...draft, notes: event.target.value }))} /></label>
      <button type="submit">{stayDraft.id ? "Verblijf opslaan" : "Verblijf toevoegen"}</button>
    </form>
    {stays.length > 0 && <div className="saved-moments manager-list">{stays.map((stay) => { const nights = daysBetween(stay.check_in_date, stay.check_out_date); return <article className="excerpt-row" key={stay.id}><div><strong>{stay.website_url ? <a href={stay.website_url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">{stayLabel(stay)}</a> : stayLabel(stay)}</strong><span>{[stay.broad_place?.label, `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`, `${nights} ${nights === 1 ? "nacht" : "nachten"}`, stayStateLabel(stay)].filter(Boolean).join(" · ")}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editStay(stay)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteStay(stay).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het verblijf kon niet worden verwijderd."))}>Verwijderen</button></div></article>; })}</div>}
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Brede verblijfskaart</h3><p>Een aparte, veilige samenvatting — zonder een koppeling met het exacte verblijf.</p></div>{cardDraft.id && <button className="secondary compact" type="button" onClick={newCard}>Nieuwe kaart</button>}</div>
      {broadPlaces.length === 0 ? <p className="help">Maak eerst hierboven een brede plaats, zoals een stad of regio.</p> : <form className="stack-form" onSubmit={(event) => void saveCard(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede verblijfskaart kon niet worden opgeslagen."))}><div className="field-row"><label>Brede plaats<select required value={cardDraft.broadPlaceId} onChange={(event) => setCardDraft((draft) => ({ ...draft, broadPlaceId: event.target.value }))}><option value="">Kies een brede plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label><label>Datumprecisie<select value={cardDraft.datePrecision} onChange={(event) => setCardDraft((draft) => ({ ...draft, datePrecision: event.target.value as BroadStayCard["date_precision"] }))}><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></select></label></div><label>Titel<input required maxLength={160} value={cardDraft.title} onChange={(event) => setCardDraft((draft) => ({ ...draft, title: event.target.value }))} placeholder="Bijvoorbeeld: Een paar nachten in Taipei" /></label><button type="submit">{cardDraft.id ? "Kaart opslaan" : "Kaart toevoegen"}</button></form>}
      {cards.length > 0 && <div className="saved-moments manager-list">{cards.map((card) => <article className="excerpt-row" key={card.id}><div><strong>{card.title}</strong><span>{card.place.label} · {card.date_precision}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editCard(card)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteCard(card).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede verblijfskaart kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
    </div>
  </section>;
}
