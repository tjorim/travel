import { Button } from "@/ui/button";

import { type DialogFocusRequest } from "../forms/useRecordDialog";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorMessage } from "../query/api";
import { textNotice, useFeedback } from "../query/feedback";
import { useTripResource } from "../query/owner-queries";
import { AlternativesPanel } from "./alternatives/AlternativesPanel";
import { type Trip } from "../api-types";
import { useCreateRequest, type CreateRequestProps } from "./create-request";
import { useFocusRequest } from "./record-focus";
import { RouteEditor } from "./routes/RouteEditor";
import { RouteList } from "./routes/RouteList";

/** The routes block: its list and alternatives, with the editor that opens a record or starts a new one. */
export function RouteManager({
  trip,
  focusId,
  createRequest,
  onCreateHandled,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
} & CreateRequestProps) {
  useLocale();
  const routesQuery = useTripResource(trip.id, "routes");
  const areasQuery = useTripResource(trip.id, "areas");
  const locationsQuery = useTripResource(trip.id, "locations");
  const documentsQuery = useTripResource(trip.id, "documents");
  const routes = routesQuery.data ?? [];
  const [message, setMessage] = useFeedback<string>(textNotice(() => m.routes_intro()));
  const focus = useFocusRequest(focusId);
  const create = useCreateRequest("route", createRequest, onCreateHandled);
  const readError =
    routesQuery.error ?? areasQuery.error ?? locationsQuery.error ?? documentsQuery.error;

  return (
    <section className="travel-card manager" aria-labelledby="routes-title">
      <div className="capture-heading">
        <div>
          <h3 id="routes-title">{m.common_routes()}</h3>
          <p>{m.routes_definition_hint()}</p>
        </div>
        <Button
          className="secondary compact"
          type="button"
          onClick={(event) => create.start(event.currentTarget)}
        >
          {m.routes_new_route()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.routes_your_routes_could_not_be_loaded)
          : routesQuery.isPending
            ? m.routes_loading_your_routes()
            : message}
      </p>
      <AlternativesPanel tripId={trip.id} kind="route" records={routes} onOpen={focus.open} />
      <RouteEditor
        trip={trip}
        focusId={focus.focusId}
        createRequest={create.createRequest}
        onCreateHandled={create.onCreateHandled}
        onNotice={setMessage}
      />
      {routes.length > 0 && <RouteList routes={routes} onInspect={focus.open} />}
    </section>
  );
}
