import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ownerRequest } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwner } from "../query/owner-queries";
import type { Visit } from "../tracker-model";
import type { PlaceValue } from "./PlacePicker";

type RouteReference = NonNullable<Visit["possible_route_duplicates"]>[number];

/** A non-blocking hint that a visit repeats a journey that already is a route. */
export function RestatedRoutesNote({ routes }: { routes: RouteReference[] }) {
  if (!routes.length) return null;
  return (
    <p className="help" role="note">
      Lijkt op de route {routes.map((route) => `“${route.title}”`).join(", ")}. Een reis hoort bij Routes; houd dit
      bezoek alleen als het over iets anders gaat.
    </p>
  );
}

type Draft = { place: PlaceValue; title: string; summary: string; startsOn: string; endsOn: string };

/** What the server needs to judge a draft: a place it knows, and a day. Anything less cannot match a route. */
function checkBody(draft: Draft) {
  const [kind, id] = draft.place.choice.split(":");
  const where =
    kind === "area"
      ? { area_id: id }
      : kind === "location"
        ? { location_id: id }
        : draft.place.choice === "new" && draft.place.newAreaId && draft.place.newAreaId !== "__new__"
          ? { area_id: draft.place.newAreaId }
          : null;
  if (!where || !draft.startsOn) return null;
  return {
    ...where,
    title: draft.title.trim() || null,
    summary: draft.summary.trim() || null,
    starts_on: draft.startsOn,
    ends_on: draft.endsOn || null,
  };
}

/** Warns, while the visit is being typed, that it restates a route. It never blocks saving and stays quiet on failure. */
export function VisitRouteHint({ tripId, draft }: { tripId: string; draft: Draft }) {
  const owner = useOwner();
  const body = checkBody(draft);
  const wanted = body ? JSON.stringify(body) : null;
  const [settled, setSettled] = useState<string | null>(wanted);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(wanted), 500);
    return () => clearTimeout(timer);
  }, [wanted]);
  const query = useQuery({
    // Below the routes list key, so editing a route refreshes the hint.
    queryKey: [...ownerKeys.tripResource(owner?.subject ?? "", tripId, "routes"), "visit-check", settled],
    enabled: owner !== null && settled !== null,
    retry: false,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      ownerRequest<RouteReference[]>(
        owner!.session,
        `${tripPath(tripId, "visits")}/route-check`,
        "De controle op routes lukte niet.",
        { method: "POST", body: JSON.parse(settled!), signal },
      ),
  });
  return settled !== null && settled === wanted ? <RestatedRoutesNote routes={query.data ?? []} /> : null;
}
