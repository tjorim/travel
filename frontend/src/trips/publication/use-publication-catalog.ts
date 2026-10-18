import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { derivativesQueryOptions, useOwner, useTripResource } from "../../query/owner-queries";
import {
  ROUTE_MODE_LABELS,
  routeTitle,
  stayLabel,
  visitTitle,
  type Trip,
} from "../../tracker-model";
import type { CatalogItem } from "./catalog";

function combineDerivatives<T>(results: { data: T | undefined; error: Error | null }[]) {
  return {
    data: results.map((result) => result.data),
    error: results.find((result) => result.error)?.error ?? null,
  };
}

/** Everything the owner can choose to share, as one list, and the first failure reading any of it. */
export function usePublicationCatalog(trip: Trip) {
  const locale = useLocale();
  const owner = useOwner();
  const placesQuery = useTripResource(trip.id, "areas");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  const locationsQuery = useTripResource(trip.id, "locations");
  const mediaQuery = useTripResource(trip.id, "media");
  const media = useMemo(() => mediaQuery.data ?? [], [mediaQuery.data]);
  // One derivative read per asset; the combined result keeps a fixed shape however many assets there are.
  const mediaDerivatives = useQueries({
    queries: media.map((asset) => derivativesQueryOptions(owner, trip.id, "media", asset.id)),
    combine: combineDerivatives,
  });

  const catalog = useMemo<CatalogItem[]>(() => {
    const approved = <T extends { review_state: string }>(items: T[] | undefined) =>
      (items ?? []).filter((item) => item.review_state === "approved");
    const updateTitles = new Map(trip.travel_updates.map((update) => [update.id, update.title]));
    return [
      ...trip.travel_updates.map((item) => ({
        kind: "travel_update" as const,
        id: item.id,
        label: item.title,
        detail: m.owner_travel_update(),
        visibility: item.visibility,
      })),
      ...(visitsQuery.data ?? []).map((item) => ({
        kind: "visit" as const,
        id: item.id,
        label: visitTitle(item),
        detail: m.assets_visit_the_place_visitor_text_and_date_the_time_only_if_you_share_it(),
        visibility: item.visibility,
      })),
      ...(placesQuery.data ?? []).map((item) => ({
        kind: "area" as const,
        id: item.id,
        label: item.label,
        detail: m.owner_area(),
        visibility: item.visibility,
      })),
      // Only locations the owner has named or shared: most locations are hotels and endpoints that stay private.
      ...(locationsQuery.data ?? [])
        .filter((item) => item.label || item.visibility !== "private")
        .map((item) => ({
          kind: "location" as const,
          id: item.id,
          label: item.label ?? m.assets_location_without_a_public_name(),
          detail: m.assets_location_name_area_and_position_only(),
          visibility: item.visibility,
        })),
      ...(routesQuery.data ?? []).map((item) => ({
        kind: "route" as const,
        id: item.id,
        label: `${ROUTE_MODE_LABELS[item.mode]}: ${routeTitle(item)}`,
        detail: m.assets_visitors_see_the_areas_transport_mode_and_line_never_the_booking_code_tr(),
        visibility: item.visibility,
      })),
      ...(staysQuery.data ?? []).map((item) => ({
        kind: "stay" as const,
        id: item.id,
        label: stayLabel(item),
        detail: m.assets_visitors_see_only_and_the_nights({
          p0: item.area?.label ?? m.assets_no_area_selected_yet(),
        }),
        visibility: item.visibility,
      })),
      ...media.flatMap((asset, index) =>
        approved(mediaDerivatives.data[index])
          .filter((item) => item.purpose === "share")
          .map((item) => ({
            kind: "media_derivative" as const,
            id: item.id,
            label: asset.original_filename ?? m.assets_approved_media_item(),
            detail:
              asset.media_kind === "video" ? m.assets_approved_video() : m.assets_approved_photo(),
            visibility: item.visibility,
            followsUpdate: updateTitles.get(item.travel_update_id ?? ""),
          })),
      ),
    ];
  }, [
    locale,
    trip,
    placesQuery.data,
    locationsQuery.data,
    routesQuery.data,
    visitsQuery.data,
    staysQuery.data,
    media,
    mediaDerivatives.data,
  ]);

  const error =
    [placesQuery, locationsQuery, routesQuery, visitsQuery, staysQuery, mediaQuery].find(
      (query) => query.isError,
    )?.error ?? null;

  return { catalog, error, derivativesError: mediaDerivatives.error };
}
