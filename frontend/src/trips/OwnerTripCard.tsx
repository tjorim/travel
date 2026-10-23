import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { ReactNode } from "react";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import type { Trip } from "../tracker-model";
import { TripCover } from "./TripCover";
import { tripDateRange, type TripState } from "./trip-state";
import { TripStatePill } from "./TripStatePill";

/** The accent edge of an owner card: green while travelling, gold ahead, plain once there is nothing to do soon. */
const ACCENT: Record<TripState, string> = {
  active: "border-travel-link",
  upcoming: "border-travel-warning-border",
  planned: "border-travel-divider",
  past: "border-travel-divider",
};

const SURFACE =
  "relative flex h-full min-w-0 flex-col rounded-travel-card border-t-4 bg-travel-surface p-travel-card-pad shadow-travel-card";

function Dates({ trip }: { trip: Trip }) {
  const range = tripDateRange(trip, "D MMMM YYYY");
  return (
    <p className="m-0 leading-normal font-medium text-travel-muted">
      {range ?? m.owner_choose_travel_dates_when_you_are_ready_to_plan()}
    </p>
  );
}

/**
 * A trip on the owner's home: its state, dates and the one next step, with a link into the workspace. The
 * featured trip (the one to continue) is larger, and puts its cover beside the text when it has one.
 */
export function HomeTripCard({
  trip,
  state,
  nextStep,
  featured = false,
}: {
  trip: Trip;
  state: TripState;
  nextStep: string;
  featured?: boolean;
}) {
  useLocale();
  const cover = trip.cover_url ? <TripCover trip={trip} /> : null;
  const text: ReactNode = (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <TripStatePill state={state} />
      <h3
        className={cn(
          "m-0 line-clamp-3 leading-tight tracking-tight",
          featured ? "text-travel-section" : "text-xl",
        )}
      >
        {trip.title}
      </h3>
      <Dates trip={trip} />
      <p className="m-0 grid gap-0.75 rounded-travel-media bg-travel-tint px-3 py-2.75 text-sm leading-normal text-travel-positive">
        <strong className="text-travel-ink">{m.owner_next_step()}</strong>
        {nextStep}
      </p>
      <Link className="action-link mt-auto w-fit" to={`/trips/${encodeURIComponent(trip.id)}`}>
        {m.owner_open_trip()}
      </Link>
    </div>
  );
  return (
    <article className={cn(SURFACE, ACCENT[state], "gap-4")}>
      {featured && cover ? (
        <div className="grid min-w-0 gap-4 min-[680px]:grid-cols-2">
          {cover}
          {text}
        </div>
      ) : (
        <>
          {cover}
          {text}
        </>
      )}
    </article>
  );
}

/** A trip in the owner's list: the whole card is one link, so it opens in a new tab like any page. */
export function ListTripCard({ trip, state }: { trip: Trip; state: TripState }) {
  useLocale();
  return (
    <Link
      className={cn(
        SURFACE,
        ACCENT[state],
        "gap-3 text-inherit no-underline transition-colors hover:bg-travel-hover focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus",
      )}
      to={`/trips/${encodeURIComponent(trip.id)}`}
    >
      <TripCover trip={trip} />
      <TripStatePill state={state} />
      <h4 className="m-0 line-clamp-3 text-xl leading-tight tracking-tight">{trip.title}</h4>
      <p className="m-0 mt-auto text-sm leading-normal text-travel-muted">
        {[tripDateRange(trip), m.owner_travel_update_count({ count: trip.travel_updates.length })]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Link>
  );
}
