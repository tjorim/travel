import { Button } from "@base-ui/react/button";
import { useRef, useState } from "react";

import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { errorNotice, FeedbackError, textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  formatDay,
  routeInPlan,
  routeTitle,
  sameJourney,
  type Route,
  type Trip,
} from "../tracker-model";
import { placeFields, samePlace } from "./PlacePicker";
import { blank, fromRoute, parseCoordinates, serverFields, type Values } from "./routes/model";
import { RouteDetails } from "./routes/RouteDetails";
import { RouteForm } from "./routes/RouteForm";
import { RouteList } from "./routes/RouteList";
import { useRouteMutations } from "./routes/use-route-mutations";

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
  const { save, remove } = useRouteMutations(trip.id);
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

  const { selected, editing, editingId } = dialog;
  // Once a route is chosen, the ideas for its journey are the rejected alternatives.
  const alternatives =
    selected && routeInPlan(selected)
      ? routes.filter((other) => other.status === "idea" && sameJourney(other, selected))
      : [];
  const readError =
    routesQuery.error ?? areasQuery.error ?? locationsQuery.error ?? documentsQuery.error;

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
          <RouteDetails
            tripId={trip.id}
            selected={selected}
            alternatives={alternatives}
            saving={save.isPending}
            onCancelAlternatives={cancelAlternatives}
            onEdit={edit}
            onDelete={setDeleteTarget}
          />
        )}
        {editing && (
          <RouteForm
            tripId={trip.id}
            record={record}
            editingId={editingId}
            bookingOpen={bookingOpen}
            onBookingOpenChange={setBookingOpen}
            areas={areas}
            locations={locations}
            documents={documents}
          />
        )}
      </RecordDialog>
      {routes.length > 0 && <RouteList routes={routes} onInspect={dialog.inspect} />}
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
