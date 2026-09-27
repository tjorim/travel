import { useEffect, useState } from "react";

import { CheckboxField, RecordForm, requiredText, SelectField, TextAreaField, TextField } from "../forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { RecordDialog } from "../RecordDialog";
import { locationName, type Area, type Location, type PlaceSearchResult, type Trip } from "../tracker-model";
import { PlaceSearchField } from "./PlaceSearchField";
import { VisibilityControl, visibilityLabel } from "./visibility";

type Values = { areaId: string; displayName: string; label: string; addressLine1: string; addressLine2: string; locality: string; adminArea: string; postalCode: string; countryCode: string; notes: string; shareAddress: boolean };
const blank = (areaId = ""): Values => ({ areaId, displayName: "", label: "", addressLine1: "", addressLine2: "", locality: "", adminArea: "", postalCode: "", countryCode: "", notes: "", shareAddress: false });
const fromPlace = (place: Location): Values => ({ areaId: place.area_id, displayName: place.display_name ?? "", label: place.label ?? "", addressLine1: place.address_line1 ?? "", addressLine2: place.address_line2 ?? "", locality: place.locality ?? "", adminArea: place.admin_area ?? "", postalCode: place.postal_code ?? "", countryCode: place.country_code ?? "", notes: place.notes ?? "", shareAddress: place.share_address });
const addressFields = (value: Values | Location) => "addressLine1" in value ? [value.addressLine1, value.addressLine2, value.postalCode, value.locality, value.adminArea] : [value.address_line1, value.address_line2, value.postal_code, value.locality, value.admin_area];
const address = (value: Values | Location) => addressFields(value).filter(Boolean).join(", ");
export const ownerLocationName = (place: Location) => place.display_name?.split(",")[0]?.trim() || locationName(place);
const optional = (value: string) => value.trim() || null;
const serverFields = { area_id: "areaId", display_name: "displayName", label: "label", address_line1: "addressLine1", address_line2: "addressLine2", locality: "locality", admin_area: "adminArea", postal_code: "postalCode", country_code: "countryCode", notes: "notes" };

/** The only location detail and editor, shared by the area inventory and record-focus links. */
export function LocationManager({ trip, areas, focusId, request, onNeedArea, onSaved }: { trip: Trip; areas: Area[]; focusId?: DialogFocusRequest | null; request?: { id?: string; areaId?: string; token: number } | null; onNeedArea: () => void; onSaved?: () => void }) {
  const locationsQuery = useTripResource(trip.id, "locations");
  const locations = locationsQuery.data ?? [];
  const dialog = useRecordDialog(locations);
  useDialogFocus(focusId, dialog.inspect);
  const [suggestion, setSuggestion] = useState<PlaceSearchResult | null>(null);
  const [resume, setResume] = useState(false);
  const [notice, setNotice] = useState("");
  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Location>({
    fallback: "De locatie kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "locations")}/${id}` : tripPath(trip.id, "locations"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: (subject) => [ownerKeys.trip(subject, trip.id), ownerKeys.trips(subject)],
  });
  const record = useRecordForm<Values, Location>({
    defaultValues: blank(), fallback: "De locatie kon niet worden opgeslagen.", serverFields,
    submit: (values) => {
      const fields = { display_name: optional(values.displayName), label: optional(values.label), address_line1: optional(values.addressLine1), address_line2: optional(values.addressLine2), locality: optional(values.locality), admin_area: optional(values.adminArea), postal_code: optional(values.postalCode), country_code: optional(values.countryCode)?.toUpperCase(), notes: optional(values.notes) };
      if (dialog.editingId) return save.mutateAsync({ id: dialog.editingId, payload: { ...fields, area_id: values.areaId, share_address: values.shareAddress } });
      return save.mutateAsync({ id: null, payload: { ...fields, area_id: values.areaId, ...(suggestion ? { osm_element_type: suggestion.osm_element_type, osm_element_id: suggestion.osm_element_id, latitude: suggestion.latitude, longitude: suggestion.longitude, viewport_north: suggestion.viewport_north, viewport_south: suggestion.viewport_south, viewport_east: suggestion.viewport_east, viewport_west: suggestion.viewport_west, navigation_provider: suggestion.navigation_provider, navigation_provider_place_id: suggestion.navigation_provider_place_id } : {}) } });
    },
    onSuccess: (place) => { setSuggestion(null); dialog.inspect(place.id); setNotice("Locatie opgeslagen."); onSaved?.(); },
  });
  function close() { dialog.close(); record.load(blank()); setSuggestion(null); setResume(false); }
  function create(areaId = "") { record.load(blank(areaId)); setSuggestion(null); setNotice(""); dialog.create(); }
  function edit(place: Location) { record.load(fromPlace(place)); setSuggestion(null); setNotice(""); dialog.edit(place.id); }
  useEffect(() => {
    if (!request) return;
    if (request.id) dialog.inspect(request.id);
    else if (resume) { record.form.setFieldValue("areaId", request.areaId ?? ""); setResume(false); dialog.create(); }
    else create(request.areaId);
    // A request token is the deliberate trigger; form and dialog callbacks change each render.
  }, [request?.token]);
  function choose(result: PlaceSearchResult) {
    setSuggestion(result);
    const proposed = { displayName: result.display_name, label: result.label, addressLine1: result.address_line1, addressLine2: result.address_line2, locality: result.locality, adminArea: result.admin_area, postalCode: result.postal_code, countryCode: result.country_code };
    for (const [key, value] of Object.entries(proposed)) if (value != null) record.form.setFieldValue(key as keyof Values, value);
  }
  const { selected, editing, editingId } = dialog;
  const addressPreview = address(record.values);
  return <>
    {resume && !editing && <button type="button" className="secondary compact" onClick={() => { setResume(false); dialog.create(); }}>Locatieconcept hervatten</button>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Locatie bewerken" : "Locatie toevoegen") : "Locatie"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <h3>{ownerLocationName(selected)}</h3>
        <p>Gebied: {areas.find((area) => area.id === selected.area_id)?.label ?? "Onbekend gebied"} · {visibilityLabel(selected.visibility)}</p>
        <p>Publieke naam: {selected.label || "Nog geen publieke naam"}</p>
        <p>Opgeslagen adres: {address(selected) || "Geen adres vastgelegd"}{selected.country_code ? `, ${selected.country_code}` : ""}</p>
        {selected.notes && <p>Privénotities: {selected.notes}</p>}
        {selected.latitude !== null && selected.longitude !== null && <p>Opgeslagen kaartpunt: {selected.latitude}, {selected.longitude} · <a href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=17/${selected.latitude}/${selected.longitude}`} target="_blank" rel="noreferrer">Op kaart bekijken</a></p>}
        {selected.osm_element_type && <p className="help">Providerlocatie: {selected.osm_element_type} {selected.osm_element_id}. Een adrescorrectie verplaatst dit kaartpunt of navigatiedoel niet.</p>}
        <p>{selected.share_address ? `Adres mag mee naar geselecteerde ontvangers: ${address(selected) || "geen deelbaar adres"}.` : "Adres wordt niet gedeeld."} {selected.visibility === "private" ? "Deze locatie bereikt momenteel geen bezoekers." : selected.visibility === "everyone" ? "Deze locatie is gekozen voor alle bezoekers wanneer de reis gepubliceerd is." : "Ontvangers worden apart gekozen in Delen."}</p>
        <VisibilityControl tripId={trip.id} kind="location" id={selected.id} value={selected.visibility} name={ownerLocationName(selected)} />
        {notice && <p role="status">{notice}</p>}
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button></div>
      </div>}
      {editing && <RecordForm record={record} submitLabel="Locatie opslaan" pendingLabel="Opslaan…" disabled={!record.values.areaId || (record.values.shareAddress && !addressPreview) || (!editingId && !record.values.displayName.trim() && !record.values.addressLine1.trim() && !record.values.locality.trim())} actions={<button className="secondary" type="button" onClick={close}>Annuleren</button>}>
        {!areas.length && <p>Maak eerst een gebied. Je locatieconcept blijft bewaard.</p>}
        {!areas.length && <button type="button" className="secondary" onClick={() => { setResume(true); dialog.close(); onNeedArea(); }}>Gebied toevoegen</button>}
        <record.form.Field name="areaId" validators={{ onChange: requiredText("Kies een gebied."), onSubmit: requiredText("Kies een gebied.") }}>{(field) => <SelectField field={field} label="Gebied"><option value="">Kies een gebied</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.label}</option>)}</SelectField>}</record.form.Field>
        {areas.length > 0 && <button type="button" className="secondary compact" onClick={() => { setResume(true); dialog.close(); onNeedArea(); }}>Nieuw gebied toevoegen</button>}
        {!editingId && <PlaceSearchField tripId={trip.id} legend="Locatie zoeken" inputLabel="Zoek via OpenStreetMap" placeholder="Bijvoorbeeld: station Brussel-Centraal" help="Een resultaat vult alleen dit concept in; pas Opslaan maakt de locatie aan." onSelect={choose} />}
        <record.form.Field name="displayName">{(field) => <TextField field={field} label="Eigen naam" optional maxLength={500} />}</record.form.Field>
        <record.form.Field name="label">{(field) => <TextField field={field} label="Publieke naam" optional maxLength={120} />}</record.form.Field>
        <div className="field-row"><record.form.Field name="addressLine1">{(field) => <TextField field={field} label="Adresregel 1" optional maxLength={160} />}</record.form.Field><record.form.Field name="addressLine2">{(field) => <TextField field={field} label="Adresregel 2" optional maxLength={160} />}</record.form.Field></div>
        <div className="field-row"><record.form.Field name="postalCode">{(field) => <TextField field={field} label="Postcode" optional maxLength={20} />}</record.form.Field><record.form.Field name="locality">{(field) => <TextField field={field} label="Plaats" optional maxLength={120} />}</record.form.Field></div>
        <div className="field-row"><record.form.Field name="adminArea">{(field) => <TextField field={field} label="Regio" optional maxLength={120} />}</record.form.Field><record.form.Field name="countryCode">{(field) => <TextField field={field} label="Landcode" optional maxLength={2} />}</record.form.Field></div>
        <record.form.Field name="notes">{(field) => <TextAreaField field={field} label="Privénotities" optional maxLength={2000} />}</record.form.Field>
        {editingId && <><record.form.Field name="shareAddress">{(field) => <CheckboxField field={field} label="Adres ook delen met ontvangers van deze locatie" disabled={!addressPreview} />}</record.form.Field><p className="help">Bezoekersadres: {addressPreview || "Geen deelbaar adres"}. Landcode: {record.values.countryCode || "geen"}. De publieke naam, landcode en plaats zijn aparte velden; adresregels, postcode, plaats en regio komen in het adresveld. De eigen naam en notities blijven privé. Een opgeslagen wijziging van een al gedeeld adres verschijnt bij bestaande ontvangers.</p><p className="help">Bij verplaatsen volgen gekoppelde bezoeken en routepunten deze locatie naar het nieuwe gebied.</p></>}
      </RecordForm>}
    </RecordDialog>
  </>;
}
