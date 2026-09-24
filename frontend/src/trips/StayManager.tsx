import { useRef, useState } from "react";

import { RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useRecordDialog } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { addDays, daysBetween, formatDay, stayLabel, type BroadPlace, type BroadStayCard, type Stay, type Trip } from "../tracker-model";

const STATUS_LABELS: Record<Stay["status"], string> = { planned: "Gepland", booked: "Geboekt", confirmed: "Bevestigd", cancelled: "Geannuleerd" };

/** The archive's hotel states: still choosing, proposed, booked. */
export function stayStateLabel(stay: Stay): string {
  if (stay.status === "planned") return stay.property_name ? "Voorgesteld" : "Nog kiezen";
  return STATUS_LABELS[stay.status];
}

type StayValues = { broadPlaceId: string; propertyName: string; checkInDate: string; checkOutDate: string; checkInTime: string; checkOutTime: string; status: Stay["status"]; websiteUrl: string; address: string; locality: string; countryCode: string; bookingReference: string; contactDetails: string; notes: string };
type CardValues = { broadPlaceId: string; title: string; datePrecision: BroadStayCard["date_precision"] };

const blankStay = (trip: Trip): StayValues => {
  const checkIn = trip.starts_on ?? new Date().toISOString().slice(0, 10);
  return { broadPlaceId: "", propertyName: "", checkInDate: checkIn, checkOutDate: addDays(checkIn, 1), checkInTime: "", checkOutTime: "", status: "planned", websiteUrl: "", address: "", locality: "", countryCode: "", bookingReference: "", contactDetails: "", notes: "" };
};
const fromStay = (stay: Stay): StayValues => ({ broadPlaceId: stay.broad_place?.id ?? "", propertyName: stay.property_name ?? "", checkInDate: stay.check_in_date, checkOutDate: stay.check_out_date, checkInTime: stay.check_in_time?.slice(0, 5) ?? "", checkOutTime: stay.check_out_time?.slice(0, 5) ?? "", status: stay.status, websiteUrl: stay.website_url ?? "", address: stay.place?.address_line1 ?? "", locality: stay.place?.locality ?? "", countryCode: stay.place?.country_code ?? "", bookingReference: stay.booking_reference ?? "", contactDetails: stay.contact_details ?? "", notes: stay.notes ?? "" });
const blankCard = (): CardValues => ({ broadPlaceId: "", title: "", datePrecision: "month" });
const fromCard = (card: BroadStayCard): CardValues => ({ broadPlaceId: card.place.id, title: card.title, datePrecision: card.date_precision });

const stayFields = { broad_place_id: "broadPlaceId", property_name: "propertyName", check_in_date: "checkInDate", check_out_date: "checkOutDate", check_in_time: "checkInTime", check_out_time: "checkOutTime", status: "status", website_url: "websiteUrl", booking_reference: "bookingReference", contact_details: "contactDetails", notes: "notes" };
const cardFields = { broad_place_id: "broadPlaceId", title: "title", date_precision: "datePrecision" };
const PLACE_FIELDS = ["propertyName", "address", "locality", "countryCode"] as const;

const checkOutAfterCheckIn = ({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } }) =>
  value && value <= String(fieldApi.form.getFieldValue("checkInDate" as never) ?? "") ? "Uitchecken gebeurt ten vroegste de ochtend na de eerste nacht." : undefined;
const httpsOnly = ({ value }: { value: string }) => value.trim() && !value.trim().startsWith("https://") ? "Gebruik een https-adres." : undefined;
const needsPlace = ({ value }: { value: string }) => value ? undefined : "Kies een brede plaats.";

export function StayManager({ trip, broadPlaces }: { trip: Trip; broadPlaces: BroadPlace[] }) {
  const staysQuery = useTripResource(trip.id, "stays");
  const cardsQuery = useTripResource(trip.id, "broad-stay-cards");
  const stays = staysQuery.data ?? [];
  const cards = cardsQuery.data ?? [];
  const stayDialog = useRecordDialog(stays);
  const cardDialog = useRecordDialog(cards);
  const [message, setMessage] = useState("Verblijven blijven private details. Brede kaarten worden altijd afzonderlijk geschreven.");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "stay"; item: Stay } | { kind: "card"; item: BroadStayCard } | null>(null);
  // A stay's place is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<StayValues>(blankStay(trip));

  const saveStay = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Stay>({
    fallback: "Het verblijf kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "stays")}/${id}` : tripPath(trip.id, "stays"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "stays")],
  });
  const deleteStay = useOwnerMutation<Stay>({
    fallback: "Het verblijf kon niet worden verwijderd.",
    request: (stay) => ({ path: `${tripPath(trip.id, "stays")}/${stay.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "stays")],
  });
  const saveCard = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, BroadStayCard>({
    fallback: "De brede verblijfskaart kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "broad-stay-cards")}/${id}` : tripPath(trip.id, "broad-stay-cards"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "broad-stay-cards")],
  });
  const deleteCard = useOwnerMutation<BroadStayCard>({
    fallback: "De brede verblijfskaart kon niet worden verwijderd.",
    request: (card) => ({ path: `${tripPath(trip.id, "broad-stay-cards")}/${card.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "broad-stay-cards")],
  });

  const stayRecord = useRecordForm<StayValues>({
    defaultValues: blankStay(trip),
    fallback: "Het verblijf kon niet worden opgeslagen.",
    serverFields: stayFields,
    submit: async (values) => {
      const propertyName = values.propertyName.trim();
      const hasPlace = Boolean(propertyName || values.address.trim() || values.locality.trim() || values.countryCode.trim());
      const placeChanged = PLACE_FIELDS.some((name) => values[name] !== baseline.current[name]);
      const id = stayDialog.editingId ?? null;
      await saveStay.mutateAsync({
        id,
        payload: {
          broad_place_id: values.broadPlaceId || null,
          property_name: propertyName || null,
          check_in_date: values.checkInDate,
          check_out_date: values.checkOutDate,
          check_in_time: values.checkInTime || null,
          check_out_time: values.checkOutTime || null,
          status: values.status,
          website_url: values.websiteUrl.trim() || null,
          booking_reference: values.bookingReference.trim() || null,
          contact_details: values.contactDetails.trim() || null,
          notes: values.notes.trim() || null,
          ...(!id || placeChanged ? { place: hasPlace ? { display_name: propertyName || null, address_line1: values.address.trim() || null, locality: values.locality.trim() || null, country_code: values.countryCode.trim().toUpperCase() || null } : null } : {}),
        },
      });
    },
    onSuccess: () => { closeStay(); setMessage("Privéverblijf opgeslagen."); },
  });
  const cardRecord = useRecordForm<CardValues>({
    defaultValues: blankCard(),
    fallback: "De brede verblijfskaart kon niet worden opgeslagen.",
    serverFields: cardFields,
    submit: async (values) => { await saveCard.mutateAsync({ id: cardDialog.editingId ?? null, payload: { broad_place_id: values.broadPlaceId, title: values.title.trim(), date_precision: values.datePrecision } }); },
    onSuccess: () => { closeCard(); setMessage("Brede verblijfskaart opgeslagen. Hij is nog niet gedeeld."); },
  });

  function loadStay(values: StayValues) { baseline.current = values; stayRecord.load(values); }
  function closeStay() { stayDialog.close(); loadStay(blankStay(trip)); }
  function newStay() { loadStay(blankStay(trip)); stayDialog.create(); }
  function editStay(stay: Stay) { loadStay(fromStay(stay)); stayDialog.edit(stay.id); }
  function closeCard() { cardDialog.close(); cardRecord.load(blankCard()); }
  function newCard() { cardRecord.load(blankCard()); cardDialog.create(); }
  function editCard(card: BroadStayCard) { cardRecord.load(fromCard(card)); cardDialog.edit(card.id); }

  function confirmDelete() {
    if (!deleteTarget) return;
    const fail = (fallback: string) => (error: unknown) => { setDeleteTarget(null); setMessage(errorMessage(error, fallback)); };
    if (deleteTarget.kind === "stay") {
      deleteStay.mutateAsync(deleteTarget.item).then(() => { closeStay(); setDeleteTarget(null); setMessage("Privéverblijf verwijderd."); }, fail("Het verblijf kon niet worden verwijderd."));
    } else {
      deleteCard.mutateAsync(deleteTarget.item).then(() => { closeCard(); setDeleteTarget(null); setMessage("Brede verblijfskaart verwijderd."); }, fail("De brede verblijfskaart kon niet worden verwijderd."));
    }
  }

  const { selected: selectedStay, editing: editingStay, editingId: editingStayId } = stayDialog;
  const readError = staysQuery.error ?? cardsQuery.error;
  const placeOptions = broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>);

  return <section className="card manager" aria-labelledby="stays-title">
    <div className="capture-heading"><div><h3 id="stays-title">Verblijven</h3><p>Een verblijf is een reeks nachten: inchecken de namiddag van de eerste nacht, uitchecken de ochtend erna. Adressen, boekingen en contactgegevens zijn uitsluitend privé.</p></div><button className="secondary compact" type="button" onClick={newStay}>Nieuw verblijf</button></div>
    <p className="help" role="status">{readError ? errorMessage(readError, "Je verblijven konden niet worden geladen.") : staysQuery.isPending ? "Laad je private verblijven…" : message}</p>
    {stays.length > 0 && <div className="saved-moments manager-list">{stays.map((stay) => {
      const nights = daysBetween(stay.check_in_date, stay.check_out_date);
      return <article className="excerpt-row" key={stay.id}>
        <button className="document-select" type="button" onClick={() => stayDialog.inspect(stay.id)}><strong>{stayLabel(stay)}</strong><span>{[stay.broad_place?.label, `${formatDay(stay.check_in_date)} → ${formatDay(stay.check_out_date)}`, `${nights} ${nights === 1 ? "nacht" : "nachten"}`, stayStateLabel(stay)].filter(Boolean).join(" · ")}</span></button>
        <button className="danger compact" type="button" onClick={() => setDeleteTarget({ kind: "stay", item: stay })}>Verwijderen</button>
      </article>;
    })}</div>}
    <RecordDialog open={editingStay || selectedStay !== null} title={editingStay ? (editingStayId ? "Verblijf bewerken" : "Verblijf toevoegen") : "Verblijf"} dirty={editingStay && stayRecord.dirty} onDismiss={closeStay}>
      {!editingStay && selectedStay && <div className="stack-form">
        <div><h3>{stayLabel(selectedStay)}</h3><p>{selectedStay.place?.address_line1}{selectedStay.place?.locality ? ` · ${selectedStay.place.locality}` : ""}</p><p>{selectedStay.booking_reference ? `Boekingsreferentie: ${selectedStay.booking_reference}` : "Geen boekingsreferentie"}</p></div>
        <div className="button-row"><button type="button" onClick={() => editStay(selectedStay)}>Bewerken</button><button className="danger" type="button" onClick={() => setDeleteTarget({ kind: "stay", item: selectedStay })}>Verwijderen</button></div>
      </div>}
      {editingStay && <RecordForm record={stayRecord} submitLabel={editingStayId ? "Verblijf opslaan" : "Verblijf toevoegen"} pendingLabel="Opslaan…">
        <div className="field-row">
          <stayRecord.form.Field name="broadPlaceId">{(field) => <SelectField field={field} label="Stad of gebied" optional><option value="">Geen brede plaats</option>{placeOptions}</SelectField>}</stayRecord.form.Field>
          <stayRecord.form.Field name="status">{(field) => <SelectField field={field} label="Status">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField>}</stayRecord.form.Field>
        </div>
        <stayRecord.form.Field name="propertyName">{(field) => <TextField field={field} label="Accommodatie" optional="(leeg zolang je nog kiest)" maxLength={160} />}</stayRecord.form.Field>
        <div className="field-row">
          <stayRecord.form.Field name="checkInDate" validators={{ onChange: requiredText("Kies de eerste nacht."), onSubmit: requiredText("Kies de eerste nacht.") }} listeners={{ onChange: ({ value }) => { if (value && String(stayRecord.form.getFieldValue("checkOutDate")) <= value) stayRecord.form.setFieldValue("checkOutDate", addDays(value, 1)); } }}>{(field) => <TextField field={field} label="Eerste nacht (inchecken)" required type="date" />}</stayRecord.form.Field>
          <stayRecord.form.Field name="checkOutDate" validators={{ onChangeListenTo: ["checkInDate"], onChange: checkOutAfterCheckIn, onSubmit: checkOutAfterCheckIn }}>{(field) => <TextField field={field} label="Uitchecken (ochtend)" required type="date" />}</stayRecord.form.Field>
        </div>
        <stayRecord.form.Subscribe selector={(state) => [state.values.checkInDate, state.values.checkOutDate] as const}>{([checkIn, checkOut]) => {
          const nights = checkIn && checkOut ? daysBetween(checkIn, checkOut) : 0;
          return <p className="help">{nights > 0 ? `${nights} ${nights === 1 ? "nacht" : "nachten"}` : "Kies een uitcheckdatum na de eerste nacht."} · lokale datums bij het verblijf</p>;
        }}</stayRecord.form.Subscribe>
        <div className="field-row">
          <stayRecord.form.Field name="checkInTime">{(field) => <TextField field={field} label="Inchecktijd" optional type="time" />}</stayRecord.form.Field>
          <stayRecord.form.Field name="checkOutTime">{(field) => <TextField field={field} label="Uitchecktijd" optional type="time" />}</stayRecord.form.Field>
        </div>
        <div className="field-row">
          <stayRecord.form.Field name="address">{(field) => <TextField field={field} label="Adres" optional maxLength={160} />}</stayRecord.form.Field>
          <stayRecord.form.Field name="locality">{(field) => <TextField field={field} label="Plaats" optional maxLength={120} />}</stayRecord.form.Field>
        </div>
        <div className="field-row">
          <stayRecord.form.Field name="countryCode">{(field) => <TextField field={field} label="Landcode" optional maxLength={2} placeholder="TW" />}</stayRecord.form.Field>
          <stayRecord.form.Field name="websiteUrl" validators={{ onBlur: httpsOnly, onSubmit: httpsOnly }}>{(field) => <TextField field={field} label="Website" optional="(optioneel, https)" type="url" maxLength={2048} placeholder="https://" />}</stayRecord.form.Field>
        </div>
        <stayRecord.form.Field name="bookingReference">{(field) => <TextField field={field} label="Boekingsreferentie" optional maxLength={255} />}</stayRecord.form.Field>
        <stayRecord.form.Field name="contactDetails">{(field) => <TextAreaField field={field} label="Contactgegevens" optional maxLength={2000} rows={3} />}</stayRecord.form.Field>
        <stayRecord.form.Field name="notes">{(field) => <TextAreaField field={field} label="Notities" optional maxLength={4000} rows={3} />}</stayRecord.form.Field>
      </RecordForm>}
    </RecordDialog>
    <div className="manager-subsection"><div className="capture-heading"><div><h3>Brede verblijfskaart</h3><p>Een aparte, veilige samenvatting — zonder een koppeling met het exacte verblijf.</p></div><button className="secondary compact" type="button" onClick={newCard}>Nieuwe kaart</button></div>
      {broadPlaces.length === 0 ? <p className="help">Maak eerst hierboven een brede plaats, zoals een stad of regio.</p> : <RecordDialog open={cardDialog.editing} title={cardDialog.editingId ? "Brede verblijfskaart bewerken" : "Brede verblijfskaart toevoegen"} dirty={cardRecord.dirty} onDismiss={closeCard}>
        <RecordForm record={cardRecord} submitLabel={cardDialog.editingId ? "Kaart opslaan" : "Kaart toevoegen"} pendingLabel="Opslaan…">
          <div className="field-row">
            <cardRecord.form.Field name="broadPlaceId" validators={{ onChange: needsPlace, onSubmit: needsPlace }}>{(field) => <SelectField field={field} label="Brede plaats" required><option value="">Kies een brede plaats</option>{placeOptions}</SelectField>}</cardRecord.form.Field>
            <cardRecord.form.Field name="datePrecision">{(field) => <SelectField field={field} label="Datumprecisie"><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></SelectField>}</cardRecord.form.Field>
          </div>
          <cardRecord.form.Field name="title" validators={{ onChange: requiredText("Geef de kaart een titel."), onSubmit: requiredText("Geef de kaart een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} placeholder="Bijvoorbeeld: Een paar nachten in Taipei" />}</cardRecord.form.Field>
        </RecordForm>
      </RecordDialog>}
      {cards.length > 0 && <div className="saved-moments manager-list">{cards.map((card) => <article className="excerpt-row" key={card.id}>
        <button className="document-select" type="button" onClick={() => editCard(card)}><strong>{card.title}</strong><span>{card.place.label} · {card.date_precision}</span></button>
        <button className="danger compact" type="button" onClick={() => setDeleteTarget({ kind: "card", item: card })}>Verwijderen</button>
      </article>)}</div>}
    </div>
    {deleteTarget && <RecordDialog open title="Verwijderen bevestigen" onDismiss={() => setDeleteTarget(null)}><DeleteConfirmation title={`“${deleteTarget.kind === "stay" ? stayLabel(deleteTarget.item) : deleteTarget.item.title}” verwijderen?`} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} /></RecordDialog>}
  </section>;
}
