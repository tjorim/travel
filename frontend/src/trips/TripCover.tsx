import { cn } from "cn";

import { useAuth } from "../auth-context";
import type { Trip } from "../tracker-model";
import { OwnerImage } from "./OwnerImage";

/**
 * The owner's own view of the trip cover, or nothing when the trip has none: the text beside it stands on its
 * own, like a visitor's text-only header. The image is decorative here (the trip's title sits next to it), and
 * it is fetched with the owner's session, never through a visitor route.
 */
export function TripCover({
  trip,
  wide = false,
  className,
}: {
  trip: Pick<Trip, "cover_url">;
  /** A banner that widens from the card ratio to the hero ratio on large screens, as a visitor's header does. */
  wide?: boolean;
  className?: string;
}) {
  const { session } = useAuth();
  if (!trip.cover_url || !session) return null;
  return (
    <OwnerImage
      session={session}
      url={trip.cover_url}
      alt=""
      className={cn(
        "block aspect-travel-cover w-full rounded-travel-media bg-travel-tint object-cover",
        wide && "max-h-80 rounded-travel-card min-[960px]:aspect-travel-hero",
        className,
      )}
    />
  );
}
