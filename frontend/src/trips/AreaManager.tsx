import { Button } from "@base-ui/react/button";
import { useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { timeZoneOptions, type Area, type PlaceSearchResult, type Trip } from "../tracker-model";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { PlaceSearchField } from "./PlaceSearchField";
import { AreaContents } from "./AreaContents";
import { LocationManager, ownerLocationName } from "./LocationManager";

type Values = {
  label: string;
  countryCode: string;
  region: string;
  latitude: string;
  longitude: string;
  timezone: string;
};
const blank = (): Values => ({ label: "", countryCode: "", region: "", latitude: "", longitude: "", timezone: "" });
const fromArea = (area: Area): Values => ({
  label: area.label,
  countryCode: area.country_code ?? "",
  region: area.region ?? "",
  latitude: area.latitude?.toString() ?? "",
  longitude: area.longitude?.toString() ?? "",
  timezone: area.timezone ?? "",
});
const serverFields = {
  label: "label",
  country_code: "countryCode",
  region: "region",
  latitude: "latitude",
  longitude: "longitude",
  timezone: "timezone",
};

const bothCoordinates = ({
  value,
  fieldApi,
}: {
  value: string;
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
}) =>
  (value === "") !== (String(fieldApi.form.getFieldValue("longitude" as never) ?? "") === "")
    ? "Vul beide kaartcoördinaten in of laat beide leeg."
    : undefined;
const areaCoordinate = (value: number) => (Math.round(value * 100) / 100).toString();

export function AreaManager({
  trip,
  focusId,
  locationFocusId,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
  locationFocusId?: DialogFocusRequest | null;
}) {
  const areasQuery = useTripResource(trip.id, "areas");
  const areas = areasQuery.data ?? [];
  const locationsQuery = useTripResource(trip.id, "locations");
  const locations = locationsQuery.data ?? [];
  const [locationRequest, setLocationRequest] = useState<{ id?: string; areaId?: string; token: number } | null>(null);
  const [resumeLocation, setResumeLocation] = useState(false);
  const requestLocation = (id?: string, areaId?: string) =>
    setLocationRequest({ id, areaId, token: Date.now() + Math.random() });
  const dialog = useRecordDialog(areas);
  useDialogFocus(focusId, dialog.inspect);
  const [message, setMessage] = useState(
    "Een gebied is een stad of regio, zonder adres. Het is niet automatisch openbaar.",
  );

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Area>({
    fallback: "Het gebied kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "areas")}/${id}` : tripPath(trip.id, "areas"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    // Visits, stays and reisupdates embed the area, so the trip is refreshed with it.
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });
  const remove = useOwnerMutation<Area>({
    fallback: "Het gebied kon niet worden verwijderd.",
    request: (area) => ({ path: `${tripPath(trip.id, "areas")}/${area.id}`, method: "DELETE" }),
    invalidate: (subject) => [ownerKeys.tripResource(subject, trip.id, "areas"), ownerKeys.trips(subject)],
  });

  const record = useRecordForm<Values, Area>({
    defaultValues: blank(),
    fallback: "Het gebied kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      return save.mutateAsync({
        id: dialog.editingId ?? null,
        payload: {
          label: values.label.trim(),
          country_code: values.countryCode.trim().toUpperCase() || null,
          region: values.region.trim() || null,
          latitude: values.latitude === "" ? null : Number(values.latitude),
          longitude: values.longitude === "" ? null : Number(values.longitude),
          timezone: values.timezone.trim() || null,
        },
      });
    },
    onSuccess: (area) => {
      close();
      setMessage("Gebied opgeslagen. Je kunt het bewust aan een bezoek, reisupdate of verblijf koppelen.");
      if (resumeLocation) {
        setResumeLocation(false);
        requestLocation(undefined, area.id);
      }
    },
  });

  function close() {
    dialog.close();
    record.load(blank());
  }
  function create() {
    record.load(blank());
    dialog.create();
  }
  function edit(area: Area) {
    record.load(fromArea(area));
    dialog.edit(area.id);
  }
  function erase(area: Area) {
    remove.mutateAsync(area).then(
      () => {
        close();
        setMessage("Gebied verwijderd.");
      },
      (error: unknown) => setMessage(errorMessage(error, "Het gebied kon niet worden verwijderd.")),
    );
  }
  function useSearchResult(result: PlaceSearchResult) {
    record.form.setFieldValue("label", result.locality ?? result.admin_area ?? result.display_name ?? "");
    record.form.setFieldValue("countryCode", result.country_code ?? "");
    record.form.setFieldValue("region", result.admin_area ?? "");
    // A Nominatim result can be a precise POI. Areas deliberately use a
    // roughly kilometre-sized map point; the owner can still edit every field.
    record.form.setFieldValue("latitude", typeof result.latitude === "number" ? areaCoordinate(result.latitude) : "");
    record.form.setFieldValue(
      "longitude",
      typeof result.longitude === "number" ? areaCoordinate(result.longitude) : "",
    );
  }

  const summary = (area: Area) =>
    [area.region, area.country_code, area.timezone].filter(Boolean).join(" · ") || "Alleen voor deze reis";
  const { selected, editing, editingId } = dialog;

  return (
    <section className="travel-card manager" id="areas" aria-labelledby="areas-title">
      <span id="locations" />
      <div className="capture-heading">
        <div>
          <h3 id="areas-title">Gebieden en locaties</h3>
          <p>
            Een stad of regio die je kunt hergebruiken. Locaties, verblijven, reisupdates en vervoer horen bij een
            gebied. Een gebied is privé tot je kiest wie het ziet en deelt nooit automatisch zijn locaties.
          </p>
        </div>
        <div className="button-row">
          <Button className="secondary compact" type="button" onClick={create}>
            Gebied toevoegen
          </Button>
          <Button className="secondary compact" type="button" onClick={() => requestLocation()}>
            Locatie toevoegen
          </Button>
        </div>
      </div>
      <p className="help" role="status">
        {areasQuery.error ? errorMessage(areasQuery.error, "Je gebieden konden niet worden geladen.") : message}
      </p>
      {locationsQuery.error && (
        <p role="status">{errorMessage(locationsQuery.error, "Je locaties konden niet worden geladen.")}</p>
      )}
      {locationsQuery.isPending && <p role="status">Locaties laden…</p>}
      {areas.length ? (
        <div className="saved-records mt-0.5">
          {areas.map((area) => (
            <article className="grid gap-2.5 rounded-xl border border-travel-divider bg-white p-4" key={area.id}>
              <div className="capture-heading m-0 items-center max-[620px]:flex-col max-[620px]:items-stretch">
                <Button
                  className="document-select"
                  type="button"
                  onClick={() => dialog.inspect(area.id)}
                  aria-label={`Gebied ${area.label} bekijken`}
                >
                  <strong>{area.label}</strong>
                  <span>
                    {summary(area)} · {visibilityLabel(area.visibility)}
                  </span>
                </Button>
                <Button className="secondary compact" type="button" onClick={() => requestLocation(undefined, area.id)}>
                  Locatie toevoegen
                </Button>
              </div>
              {!locationsQuery.isPending && !locationsQuery.error && (
                <div className="saved-records ml-4 border-l-2 border-travel-divider pl-4 max-[620px]:ml-1 max-[620px]:pl-3">
                  {locations
                    .filter((place) => place.area_id === area.id)
                    .map((place) => (
                      <Button
                        className="document-select"
                        key={place.id}
                        type="button"
                        onClick={() => requestLocation(place.id)}
                      >
                        <strong>{ownerLocationName(place)}</strong>
                        <span>
                          {[place.address_line1, place.locality, place.country_code, visibilityLabel(place.visibility)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </Button>
                    ))}
                  {!locations.some((place) => place.area_id === area.id) && (
                    <p className="help">Nog geen locaties in dit gebied.</p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        !areasQuery.isPending &&
        !areasQuery.error && <p>Nog geen gebieden. Voeg een gebied toe om er locaties in te bewaren.</p>
      )}
      <LocationManager
        trip={trip}
        areas={areas}
        focusId={locationFocusId}
        request={locationRequest}
        onNeedArea={() => {
          setResumeLocation(true);
          create();
        }}
      />
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? "Gebied bewerken" : "Gebied toevoegen") : "Gebied"}
        dirty={editing && record.dirty}
        onDismiss={() => {
          close();
          setResumeLocation(false);
        }}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.label}</h3>
              <p>{summary(selected)}</p>
              {selected.latitude !== null && selected.longitude !== null && (
                <p>
                  Kaartpunt: {selected.latitude}, {selected.longitude}
                </p>
              )}
            </div>
            <AreaContents
              trip={trip}
              area={selected}
              onOpenLocation={(id) => {
                dialog.close();
                requestLocation(id);
              }}
            />
            <VisibilityControl
              tripId={trip.id}
              kind="area"
              id={selected.id}
              value={selected.visibility}
              name={selected.label}
            />
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                Bewerken
              </Button>
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                Verwijderen
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={`Gebied “${selected.label}” verwijderen?`}
                description="Dit kan alleen wanneer het gebied niet meer in een bezoek, reisupdate, locatie, verblijf of route wordt gebruikt. Een eventuele losse selectie voor delen wordt ook verwijderd."
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm record={record} submitLabel="Gebied opslaan" pendingLabel="Opslaan…">
            <PlaceSearchField
              tripId={trip.id}
              legend="Stad of regio zoeken"
              inputLabel="Zoek stad of regio"
              placeholder="Bijvoorbeeld: Taipei"
              help="Gebruik dit voor een stad of regio. Een resultaat wordt pas bij opslaan bewaard en het punt wordt op ongeveer één kilometer afgerond."
              onSelect={useSearchResult}
            />
            <div className="field-row">
              <record.form.Field
                name="label"
                validators={{
                  onChange: requiredText("Geef het gebied een naam."),
                  onSubmit: requiredText("Geef het gebied een naam."),
                }}
              >
                {(field) => <TextField field={field} label="Naam" required maxLength={120} />}
              </record.form.Field>
              <record.form.Field name="countryCode">
                {(field) => <TextField field={field} label="Landcode" optional maxLength={2} />}
              </record.form.Field>
            </div>
            <div className="field-row">
              <record.form.Field name="region">
                {(field) => <TextField field={field} label="Regio" optional maxLength={120} />}
              </record.form.Field>
              <record.form.Field name="timezone">
                {(field) => (
                  <TextField
                    field={field}
                    label="Tijdzone"
                    optional="(optioneel, privé)"
                    list="area-time-zones"
                    maxLength={64}
                  />
                )}
              </record.form.Field>
            </div>
            <datalist id="area-time-zones">
              {timeZoneOptions().map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            <div className="field-row">
              <record.form.Field
                name="latitude"
                validators={{ onChangeListenTo: ["longitude"], onChange: bothCoordinates, onSubmit: bothCoordinates }}
              >
                {(field) => (
                  <TextField field={field} label="Breedtegraad" optional type="number" min={-90} max={90} step="any" />
                )}
              </record.form.Field>
              <record.form.Field name="longitude">
                {(field) => (
                  <TextField field={field} label="Lengtegraad" optional type="number" min={-180} max={180} step="any" />
                )}
              </record.form.Field>
            </div>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
