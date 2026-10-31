import { Link } from "@tanstack/react-router";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useTripResource } from "../query/owner-queries";
import type { Area, Trip } from "../tracker-model";
import { sectionPath } from "./workspace-sections";

/**
 * A new trip's overview offers one clear start instead of an empty page: places first, then the stays and routes
 * between them. It shows only once every list has loaded and all of them are empty, so it never flashes at a trip
 * that is merely still loading.
 */
export function FirstSteps({ trip, areas }: { trip: Trip; areas: Area[] }) {
  useLocale();
  const visits = useTripResource(trip.id, "visits");
  const stays = useTripResource(trip.id, "stays");
  const routes = useTripResource(trip.id, "routes");
  const loaded = visits.isSuccess && stays.isSuccess && routes.isSuccess;
  if (!loaded || areas.length || visits.data.length || stays.data.length || routes.data.length)
    return null;
  const to = sectionPath(trip.id, "plan");
  return (
    <section className="travel-card grid gap-3" aria-labelledby="first-steps-title">
      <h2 id="first-steps-title" className="m-0 text-travel-card-title leading-tight">
        {m.owner_first_steps_title()}
      </h2>
      <p>{m.owner_first_steps_text()}</p>
      <div className="button-row">
        <Link className="action-link" to={to} hash="areas">
          {m.owner_first_steps_places()}
        </Link>
        <Link className="secondary action-link" to={to} hash="stays">
          {m.owner_first_steps_stay()}
        </Link>
        <Link className="secondary action-link" to={to} hash="routes">
          {m.owner_first_steps_route()}
        </Link>
      </div>
    </section>
  );
}
