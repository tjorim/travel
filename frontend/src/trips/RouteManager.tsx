import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useFeedback, FeedbackError, textNotice, errorNotice } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { useRef, useState } from "react";

import { DateField, DateTimeField } from "../forms/DateTimeFields";
import { RecordForm, SelectField, TextAreaField, TextField, TimeZoneField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { dayjs } from "../dayjs";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  ROUTE_MODE_LABELS,
  browserTimeZone,
  daysBetween,
  formatDay,
  localDate,
  locationName,
  routeInPlan,
  routeTitle,
  sameJourney,
  wallClock,
  type Route,
  type RouteMode,
  type TimedRoute,
  type Trip,
} from "../tracker-model";
import { ROUTE_STATUS_LABELS } from "./labels";
import { VisibilityControl, visibilityLabel } from "./visibility";
import {
  emptyPlace,
  hasPlace,
  PlacePicker,
  placeFields,
  placeOf,
  samePlace,
  type PlaceValue,
} from "./PlacePicker";
import { RouteGeometryEditor, type RouteCoordinate } from "./RouteGeometryEditor";
import { Field, FieldLabel, FieldSet, FieldLegend } from "../ui/field";

const STATUS_LABELS = ROUTE_STATUS_LABELS;

/** "16 nov 10:40" in the end's own zone (browser zone when none is known). */
function endpointTime(instant: string, timeZone: string | null): string {
  return dayjs(instant)
    .tz(timeZone ?? undefined)
    .format("D MMM HH:mm");
}

/** The archive's "+1 dag": calendar days between local departure and arrival. */
export function dayShift(
  route: Pick<TimedRoute, "departs_at" | "arrives_at" | "departure_timezone" | "arrival_timezone">,
): number {
  return daysBetween(
    localDate(route.departs_at, route.departure_timezone),
    localDate(route.arrives_at, route.arrival_timezone),
  );
}

type Values = {
  mode: RouteMode;
  status: Route["status"];
  label: string;
  departure: PlaceValue;
  arrival: PlaceValue;
  departsOn: string;
  departsAt: string;
  arrivesAt: string;
  departureTimezone: string;
  arrivalTimezone: string;
  carrier: string;
  serviceReference: string;
  travelClass: string;
  bookingReference: string;
  notes: string;
  documentAssetIds: string[];
  /** The drawn line as JSON text; empty when the route has none. */
  coordinates: string;
};

const NOT_ENOUGH_POINTS = m.owner_a_line_needs_at_least_two_points;

/** The line's points, or the message explaining why the text is not a usable line. */
function parseCoordinates(text: string): [number, number][] | string {
  let coordinates: unknown;
  try {
    coordinates = JSON.parse(text);
  } catch {
    return m.owner_use_valid_json_with_at_least_two_longitude_latitude_pairs();
  }
  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2 ||
    coordinates.some(
      (point) =>
        !Array.isArray(point) ||
        point.length !== 2 ||
        point.some((value) => typeof value !== "number"),
    )
  )
    return NOT_ENOUGH_POINTS();
  return coordinates as [number, number][];
}
const validCoordinates = ({ value }: { value: string }) => {
  if (!value.trim()) return undefined;
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? () => parseCoordinates(value) as string : undefined;
};
const editableCoordinates = (value: string): RouteCoordinate[] => {
  if (!value.trim()) return [];
  const parsed = parseCoordinates(value);
  return typeof parsed === "string" ? [] : parsed;
};

function blank(): Values {
  return {
    mode: "train",
    status: "planned",
    label: "",
    departure: emptyPlace(),
    arrival: emptyPlace(),
    departsOn: "",
    departsAt: "",
    arrivesAt: "",
    departureTimezone: browserTimeZone(),
    arrivalTimezone: browserTimeZone(),
    carrier: "",
    serviceReference: "",
    travelClass: "",
    bookingReference: "",
    notes: "",
    documentAssetIds: [],
    coordinates: "",
  };
}

const fromRoute = (route: Route): Values => ({
  mode: route.mode,
  status: route.status,
  label: route.label ?? "",
  departure: placeOf(route.departure_area, route.departure_location),
  arrival: placeOf(route.arrival_area, route.arrival_location),
  departsOn: route.departs_on ?? "",
  departsAt: route.departs_at ? wallClock(route.departs_at, route.departure_timezone) : "",
  arrivesAt: route.arrives_at ? wallClock(route.arrives_at, route.arrival_timezone) : "",
  departureTimezone: route.departure_timezone ?? browserTimeZone(),
  arrivalTimezone: route.arrival_timezone ?? browserTimeZone(),
  carrier: route.carrier ?? "",
  serviceReference: route.service_reference ?? "",
  travelClass: route.travel_class ?? "",
  bookingReference: route.booking_reference ?? "",
  notes: route.notes ?? "",
  documentAssetIds: [...route.document_asset_ids],
  coordinates: route.geometry ? JSON.stringify(route.geometry.coordinates) : "",
});

const serverFields = {
  mode: "mode",
  status: "status",
  label: "label",
  departs_on: "departsOn",
  departs_at: "departsAt",
  arrives_at: "arrivesAt",
  departure_timezone: "departureTimezone",
  arrival_timezone: "arrivalTimezone",
  carrier: "carrier",
  service_reference: "serviceReference",
  travel_class: "travelClass",
  booking_reference: "bookingReference",
  notes: "notes",
  geometry: "coordinates",
};

const departureChosen = ({ value }: { value: PlaceValue }) =>
  hasPlace(value) ? undefined : m.owner_choose_where_the_route_starts_an_area_or_location;
const arrivalChosen = ({
  value,
  fieldApi,
}: {
  value: PlaceValue;
  fieldApi: { form: { getFieldValue: (name: never) => unknown } };
}) => {
  if (!hasPlace(value)) return m.owner_choose_where_the_route_ends_an_area_or_location;
  const departure = fieldApi.form.getFieldValue("departure" as never) as PlaceValue | undefined;
  // A route between the very same area or location goes nowhere; "new" places are compared by the fields behind them.
  return departure && value.choice !== "new" && departure.choice === value.choice
    ? m.owner_choose_two_different_places_departure_and_arrival_are_the_same
    : undefined;
};

/** Ideas for the same journey are shown together as alternatives; a lone idea is listed like any route. */
function routeEntries(routes: Route[]): { routes: Route[]; journey?: string }[] {
  const shown = new Set<string>();
  return routes.flatMap((route) => {
    const group =
      route.status === "idea"
        ? routes.filter((item) => item.status === "idea" && sameJourney(item, route))
        : [route];
    if (group.length < 2) return [{ routes: [route] }];
    if (group.some((item) => shown.has(item.id))) return [];
    group.forEach((item) => shown.add(item.id));
    const places = `${route.departure_area.label} → ${route.arrival_area.label}`;
    return [
      {
        routes: group,
        journey: route.departs_on ? `${places} · ${formatDay(route.departs_on)}` : places,
      },
    ];
  });
}

export function RouteManager({
  trip,
  focusId,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const routesQuery = useTripResource(trip.id, "routes");
  const areasQuery = useTripResource(trip.id, "areas");
  const locationsQuery = useTripResource(trip.id, "locations");
  const documentsQuery = useTripResource(trip.id, "documents");
  const routes = routesQuery.data ?? [];
  const areas = areasQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const dialog = useRecordDialog(routes);
  useDialogFocus(focusId, dialog.inspect);
  const [message, setMessage] = useFeedback<string>(
    textNotice(() =>
      m.owner_a_route_connects_two_areas_a_day_stations_times_bookings_and_a_drawn_lin(),
    ),
  );
  const [deleteTarget, setDeleteTarget] = useState<Route | null>(null);
  // An end's location is only rewritten when one of its fields differs from what the editor opened with.
  const baseline = useRef<Values>(blank());
  // A new location can create a reusable location and its derived area.
  const refreshRoutes = (subject: string) => [
    ownerKeys.tripResource(subject, trip.id, "routes"),
    ownerKeys.tripResource(subject, trip.id, "locations"),
    ownerKeys.tripResource(subject, trip.id, "areas"),
  ];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Route>({
    fallback: m.owner_the_route_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "routes")}/${id}` : tripPath(trip.id, "routes"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    invalidate: refreshRoutes,
  });
  async function cancelAlternatives(alternatives: Route[]) {
    try {
      for (const alternative of alternatives)
        await save.mutateAsync({ id: alternative.id, payload: { status: "cancelled" } });
      dialog.close();
      setMessage(textNotice(() => m.owner_route_alternatives_cancelled()));
    } catch (error) {
      dialog.setError(errorNotice(error, m.owner_the_route_could_not_be_saved));
    }
  }
  const remove = useOwnerMutation<Route>({
    fallback: m.owner_the_route_could_not_be_deleted,
    request: (route) => ({ path: `${tripPath(trip.id, "routes")}/${route.id}`, method: "DELETE" }),
    invalidate: refreshRoutes,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.owner_the_route_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      if (Boolean(values.departsAt) !== Boolean(values.arrivesAt))
        throw new FeedbackError(() => m.owner_enter_both_departure_and_arrival_times_or_neither());
      if (values.departsAt && (!values.departureTimezone || !values.arrivalTimezone))
        throw new FeedbackError(() => m.owner_enter_both_the_departure_and_arrival_time_zones());
      // A departure time fixes the day: its local date there.
      if (
        values.departsAt &&
        values.departsOn &&
        values.departsAt.slice(0, 10) !== values.departsOn
      )
        throw new FeedbackError(() =>
          m.owner_the_departure_time_falls_on_not_on_the_selected_day_change_the_day_or_ti({
            p0: formatDay(values.departsAt.slice(0, 10)),
          }),
        );
      const line = values.coordinates.trim() ? parseCoordinates(values.coordinates) : null;
      if (typeof line === "string")
        throw new FeedbackError(() => parseCoordinates(values.coordinates) as string);
      await save.mutateAsync({
        id,
        payload: {
          mode: values.mode,
          status: values.status,
          label: values.label.trim() || null,
          departs_on: values.departsAt ? values.departsAt.slice(0, 10) : values.departsOn || null,
          // Local wall-clock times; the server resolves them in each end's zone.
          departs_at: values.departsAt ? `${values.departsAt}:00` : null,
          arrives_at: values.arrivesAt ? `${values.arrivesAt}:00` : null,
          departure_timezone: values.departsAt ? values.departureTimezone : null,
          arrival_timezone: values.departsAt ? values.arrivalTimezone : null,
          carrier: values.carrier.trim() || null,
          service_reference: values.serviceReference.trim() || null,
          travel_class: values.travelClass.trim() || null,
          booking_reference: values.bookingReference.trim() || null,
          notes: values.notes.trim() || null,
          document_asset_ids: values.documentAssetIds,
          geometry: line ? { type: "LineString", coordinates: line } : null,
          ...(!id || !samePlace(values.departure, baseline.current.departure)
            ? placeFields(values.departure, "departure_")
            : {}),
          ...(!id || !samePlace(values.arrival, baseline.current.arrival)
            ? placeFields(values.arrival, "arrival_")
            : {}),
        },
      });
    },
    onSuccess: () => {
      close();
      setMessage(textNotice(() => m.owner_route_saved()));
    },
  });

  // Booking details start open only for a route that already has some; the owner's own toggling wins after that.
  const [bookingOpen, setBookingOpen] = useState(false);
  function load(values: Values) {
    baseline.current = values;
    setBookingOpen(Boolean(values.carrier || values.bookingReference || values.notes));
    record.load(values);
  }
  function close() {
    dialog.close();
    load(blank());
  }
  function create() {
    load(blank());
    dialog.create();
  }
  function edit(route: Route) {
    load(fromRoute(route));
    dialog.edit(route.id);
  }
  function confirmDelete(route: Route) {
    remove.mutateAsync(route).then(
      () => {
        close();
        setDeleteTarget(null);
        setMessage(textNotice(() => m.owner_route_deleted()));
      },
      (error: unknown) => {
        setDeleteTarget(null);
        dialog.setError(errorNotice(error, m.owner_the_route_could_not_be_deleted));
      },
    );
  }

  /** The area a place value is in: what it names, or the area of the location it names. */
  const areaIdOf = (value: PlaceValue): string => {
    const [kind, id] = value.choice.split(":");
    return kind === "area"
      ? id
      : kind === "location"
        ? (locations.find((location) => location.id === id)?.area_id ?? "")
        : value.newAreaId;
  };
  const areaPoint = (value: PlaceValue): { label: string; coordinates: RouteCoordinate }[] => {
    if (value.choice.startsWith("location:")) {
      const location = locations.find(
        (candidate) => candidate.id === value.choice.slice("location:".length),
      );
      if (
        location?.visibility === "everyone" &&
        location.latitude !== null &&
        location.longitude !== null
      ) {
        return [
          { label: locationName(location), coordinates: [location.longitude, location.latitude] },
        ];
      }
    }
    if (
      value.newAreaId === "__new__" &&
      value.newAreaCandidate?.latitude != null &&
      value.newAreaCandidate.longitude != null
    ) {
      return [
        {
          label: value.newAreaCandidate.label,
          coordinates: [value.newAreaCandidate.longitude, value.newAreaCandidate.latitude],
        },
      ];
    }
    const area = areas.find((candidate) => candidate.id === areaIdOf(value));
    return area && area.latitude !== null && area.longitude !== null
      ? [{ label: area.label, coordinates: [area.longitude, area.latitude] }]
      : [];
  };
  const { selected, editing, editingId } = dialog;
  // Once a route is chosen, the ideas for its journey are the rejected alternatives.
  const alternatives =
    selected && routeInPlan(selected)
      ? routes.filter((other) => other.status === "idea" && sameJourney(other, selected))
      : [];
  const readError =
    routesQuery.error ?? areasQuery.error ?? locationsQuery.error ?? documentsQuery.error;
  // The times once booked, else the day alone.
  const times = (route: Route) =>
    route.departs_at && route.arrives_at
      ? `${endpointTime(route.departs_at, route.departure_timezone)} → ${endpointTime(route.arrives_at, route.arrival_timezone)}`
      : route.departs_on
        ? formatDay(route.departs_on)
        : null;
  const shift = (route: Route) => {
    if (!route.departs_at || !route.arrives_at) return "";
    const days = dayShift(route as TimedRoute);
    return days !== 0
      ? m.owner_day_shift({ count: Math.abs(days), shift: `${days > 0 ? "+" : ""}${days}` })
      : "";
  };

  return (
    <section className="travel-card manager" aria-labelledby="routes-title">
      <div className="capture-heading">
        <div>
          <h3 id="routes-title">{m.owner_routes()}</h3>
          <p>
            {m.owner_how_you_travel_from_one_area_to_another_flight_train_bus_bike_stations_t()}
          </p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.owner_new_route()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.owner_your_routes_could_not_be_loaded)
          : routesQuery.isPending
            ? m.owner_loading_your_routes()
            : message}
      </p>
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? m.owner_edit_route() : m.owner_add_route()) : m.owner_route()}
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{routeTitle(selected)}</h3>
              <p>
                {[ROUTE_MODE_LABELS[selected.mode], STATUS_LABELS[selected.status], times(selected)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p>
                {selected.booking_reference
                  ? m.owner_booking_reference_2({ p0: selected.booking_reference })
                  : m.owner_no_booking_reference()}
              </p>
              <Markdown html={selected.notes_html} text={selected.notes} />
            </div>
            {selected.geometry && (
              <RouteGeometryEditor
                coordinates={selected.geometry.coordinates}
                onChange={() => undefined}
                mode="preview"
              />
            )}
            {selected.status === "idea" ? (
              <p className="help">
                {m.owner_a_route_idea_is_a_candidate_it_covers_no_journey_does_not_count_towards_booking_and_is_never_shared()}
              </p>
            ) : (
              <>
                <VisibilityControl
                  tripId={trip.id}
                  kind="route"
                  id={selected.id}
                  value={selected.visibility}
                  name={routeTitle(selected)}
                />
                <p className="help">
                  {m.owner_visitors_see_the_areas_travel_mode_and_line_never_your_booking_code_clas()}
                </p>
              </>
            )}
            {alternatives.length > 0 && (
              <div>
                <p className="help">
                  {m.owner_route_ideas_for_this_journey({ count: alternatives.length })}
                </p>
                <Button
                  className="secondary compact"
                  type="button"
                  disabled={save.isPending}
                  onClick={() => cancelAlternatives(alternatives)}
                >
                  {m.owner_cancel_route_alternatives({ count: alternatives.length })}
                </Button>
              </div>
            )}
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.owner_edit()}
              </Button>
              <Button className="danger" type="button" onClick={() => setDeleteTarget(selected)}>
                {m.owner_delete()}
              </Button>
            </div>
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? m.owner_save_route() : m.owner_add_route()}
            pendingLabel={m.owner_saving()}
          >
            <div className="field-row">
              <record.form.Field name="mode">
                {(input) => (
                  <SelectField field={input} label={m.owner_transport()}>
                    {Object.entries(ROUTE_MODE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
              <record.form.Field name="status">
                {(input) => (
                  <SelectField field={input} label={m.owner_status()}>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <record.form.Subscribe selector={(state) => state.values.status}>
              {(status) =>
                status === "idea" && (
                  <p className="help">
                    {m.owner_a_route_idea_is_a_candidate_it_covers_no_journey_does_not_count_towards_booking_and_is_never_shared()}
                  </p>
                )
              }
            </record.form.Subscribe>
            <record.form.Field name="label">
              {(input) => (
                <TextField
                  field={input}
                  label={m.owner_name()}
                  optional
                  maxLength={160}
                  placeholder={m.owner_without_a_name_the_route_is_called_departure_arrival()}
                />
              )}
            </record.form.Field>
            <record.form.Field name="departure" validators={{ onSubmit: departureChosen }}>
              {(input) => (
                <PlacePicker
                  tripId={trip.id}
                  label={m.owner_departure()}
                  value={input.state.value}
                  onChange={(value) => input.handleChange(value)}
                  error={input.state.meta.errors
                    .map((error) => (typeof error === "function" ? error() : error))
                    .find((error) => typeof error === "string")}
                />
              )}
            </record.form.Field>
            <record.form.Field name="arrival" validators={{ onSubmit: arrivalChosen }}>
              {(input) => (
                <PlacePicker
                  tripId={trip.id}
                  label={m.owner_arrival()}
                  value={input.state.value}
                  onChange={(value) => input.handleChange(value)}
                  error={input.state.meta.errors
                    .map((error) => (typeof error === "function" ? error() : error))
                    .find((error) => typeof error === "string")}
                />
              )}
            </record.form.Field>
            <record.form.Field name="departsOn">
              {(input) => <DateField field={input} label={m.owner_departure_day()} optional />}
            </record.form.Field>
            <FieldSet className="grid gap-3">
              <FieldLegend>
                {m.owner_times()}{" "}
                <span className="font-medium text-travel-optional">
                  {m.owner_optional_once_you_choose_a_connection()}
                </span>
              </FieldLegend>
              <div className="field-row">
                <record.form.Field name="departsAt">
                  {(input) => (
                    <DateTimeField field={input} label={m.owner_departure_time_local()} optional />
                  )}
                </record.form.Field>
                <record.form.Field name="departureTimezone">
                  {(input) => (
                    <TimeZoneField
                      field={input}
                      label={m.owner_departure_time_zone()}
                      optional
                      maxLength={64}
                      placeholder="Europe/Amsterdam"
                    />
                  )}
                </record.form.Field>
              </div>
              <div className="field-row">
                <record.form.Field name="arrivesAt">
                  {(input) => (
                    <DateTimeField field={input} label={m.owner_arrival_time_local()} optional />
                  )}
                </record.form.Field>
                <record.form.Field name="arrivalTimezone">
                  {(input) => (
                    <TimeZoneField
                      field={input}
                      label={m.owner_arrival_time_zone()}
                      optional
                      maxLength={64}
                      placeholder="Asia/Taipei"
                    />
                  )}
                </record.form.Field>
              </div>
            </FieldSet>
            <Collapsible.Root open={bookingOpen} onOpenChange={setBookingOpen}>
              <Collapsible.Trigger className="disclosure-trigger">
                {m.owner_booking_details_optional_private()}
              </Collapsible.Trigger>
              <Collapsible.Panel keepMounted className="mt-2.5 grid gap-3">
                <div className="field-row">
                  <record.form.Field name="carrier">
                    {(input) => (
                      <TextField
                        field={input}
                        label={m.owner_carrier()}
                        optional
                        maxLength={160}
                        placeholder={m.owner_for_example_eva_air()}
                      />
                    )}
                  </record.form.Field>
                  <record.form.Field name="serviceReference">
                    {(input) => (
                      <TextField
                        field={input}
                        label={m.owner_flight_service_number()}
                        optional
                        maxLength={40}
                        placeholder="BR-087"
                      />
                    )}
                  </record.form.Field>
                </div>
                <record.form.Field name="travelClass">
                  {(input) => (
                    <TextField
                      field={input}
                      label={m.owner_travel_class()}
                      optional
                      maxLength={80}
                      placeholder={m.owner_for_example_premium_economy()}
                    />
                  )}
                </record.form.Field>
                <record.form.Field name="bookingReference">
                  {(input) => (
                    <TextField
                      field={input}
                      label={m.owner_booking_reference_3()}
                      optional
                      maxLength={255}
                    />
                  )}
                </record.form.Field>
                <record.form.Field name="notes">
                  {(input) => (
                    <MarkdownField
                      field={input}
                      label={m.owner_notes()}
                      optional
                      maxLength={4000}
                      rows={3}
                    />
                  )}
                </record.form.Field>
                {documents.length > 0 && (
                  <record.form.Field name="documentAssetIds">
                    {(input) => (
                      <FieldSet className="grid gap-2">
                        <FieldLegend>
                          {m.owner_linked_documents()}{" "}
                          <span className="font-medium text-travel-optional">
                            {m.owner_optional()}
                          </span>
                        </FieldLegend>
                        {documents.map((document) => (
                          <Field className="contents" key={document.id}>
                            <FieldLabel className="flex items-center gap-2 rounded-lg border border-travel-divider bg-travel-surface px-2.75 py-2.5 font-semibold">
                              <TravelCheckbox
                                checked={input.state.value.includes(document.id)}
                                onCheckedChange={() =>
                                  input.handleChange(
                                    input.state.value.includes(document.id)
                                      ? input.state.value.filter((id) => id !== document.id)
                                      : [...input.state.value, document.id],
                                  )
                                }
                              />
                              {document.title}
                            </FieldLabel>
                          </Field>
                        ))}
                      </FieldSet>
                    )}
                  </record.form.Field>
                )}
              </Collapsible.Panel>
            </Collapsible.Root>
            <record.form.Field
              name="coordinates"
              validators={{ onBlur: validCoordinates, onSubmit: validCoordinates }}
            >
              {(input) => (
                <FieldSet>
                  <FieldLegend>
                    {m.owner_line_on_the_map()}{" "}
                    <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                  </FieldLegend>
                  <RouteGeometryEditor
                    coordinates={editableCoordinates(input.state.value)}
                    onChange={(coordinates) =>
                      input.handleChange(coordinates.length ? JSON.stringify(coordinates) : "")
                    }
                    suggestions={[
                      ...areaPoint(record.form.state.values.departure),
                      ...areaPoint(record.form.state.values.arrival),
                    ]}
                  />
                  <Collapsible.Root className="border-t border-travel-divider pt-2.5">
                    <Collapsible.Trigger className="disclosure-trigger">
                      {m.owner_advanced_paste_coordinates_as_json()}
                    </Collapsible.Trigger>
                    <Collapsible.Panel keepMounted className="mt-2.5">
                      <TextAreaField
                        field={input}
                        label={m.owner_line_coordinates_json()}
                        optional
                        placeholder="[[121.5,25.0],[121.6,25.1]]"
                      />
                    </Collapsible.Panel>
                  </Collapsible.Root>
                </FieldSet>
              )}
            </record.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
      {routes.length > 0 && (
        <div className="saved-records mt-0.5">
          {routeEntries(routes).map((entry) => {
            const rows = entry.routes.map((route) => (
              <article className="excerpt-row" key={route.id}>
                <Button
                  className="document-select"
                  type="button"
                  onClick={() => dialog.inspect(route.id)}
                  aria-label={m.owner_view_route({ p0: routeTitle(route) })}
                >
                  <strong>{routeTitle(route)}</strong>
                  <span>
                    {[
                      ROUTE_MODE_LABELS[route.mode],
                      [times(route), shift(route)].filter(Boolean).join(""),
                      STATUS_LABELS[route.status],
                      route.carrier,
                      route.geometry ? m.owner_with_line() : null,
                      visibilityLabel(route.visibility),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Button>
              </article>
            ));
            if (!entry.journey) return rows;
            const label = m.owner_route_alternatives({ journey: entry.journey });
            return (
              <div
                key={entry.routes[0].id}
                role="group"
                aria-label={label}
                className="border-l-2 border-travel-border pl-1"
              >
                <p className="help font-bold">{label}</p>
                {rows}
              </div>
            );
          })}
        </div>
      )}
      {deleteTarget && (
        <DeleteConfirmation
          title={m.owner_delete_route({ p0: routeTitle(deleteTarget) })}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => confirmDelete(deleteTarget)}
        />
      )}
    </section>
  );
}
