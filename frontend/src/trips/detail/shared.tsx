import { Link } from "@tanstack/react-router";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { useOwner } from "../../query/owner-queries";
import { formatInstant, locationName, type Location, type MediaAsset } from "../../tracker-model";
import { OwnerImage } from "../OwnerImage";
import type { RecordKind } from "../record-focus";
import { sectionForRecord } from "../workspace-sections";

export type OwnerSession = NonNullable<ReturnType<typeof useOwner>>["session"];

/** A link to the trip workspace that opens the given record's dialog there. */
export function RecordLink({
  tripId,
  kind,
  id,
  children,
}: {
  tripId: string;
  kind: RecordKind;
  id: string;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <Link
      className="action-link compact"
      to={`/trips/${encodeURIComponent(tripId)}/${sectionForRecord(kind)}`}
      state={{ openRecord: { kind, id } }}
    >
      {children}
    </Link>
  );
}

/** A record's title beside a link to its dialog, kept out of the heading's own accessible name. */
export function RecordHeading({
  tripId,
  kind,
  id,
  children,
}: {
  tripId: string;
  kind: RecordKind;
  id: string;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <div className="flex items-baseline justify-between gap-2.5 [&_h3]:m-0">
      <h3>{children}</h3>
      <RecordLink tripId={tripId} kind={kind} id={id}>
        {m.owner_open()}
      </RecordLink>
    </div>
  );
}

export function placeLabel(place: Location | null): string {
  if (!place) return m.owner_no_location_captured();
  const name = locationName(place);
  const extra = [
    place.address_line1,
    place.address_line2,
    place.postal_code,
    place.locality,
    place.admin_area,
    place.country_code,
  ].filter(
    (value, index, values): value is string =>
      Boolean(value) && value !== name && values.indexOf(value) === index,
  );
  return extra.length ? `${name} · ${extra.join(" · ")}` : name;
}

export function timestamp(value: string | null): string {
  return value ? formatInstant(value) : "—";
}

export function MediaPreview({ asset, session }: { asset: MediaAsset; session: OwnerSession }) {
  useLocale();
  return asset.thumbnail_url ? (
    <OwnerImage
      session={session}
      url={asset.thumbnail_url}
      alt=""
      className="block h-24 w-35 rounded-lg bg-travel-media-bg object-cover"
    />
  ) : (
    <span
      className="block h-24 w-35 rounded-lg bg-travel-media-bg object-cover media-thumbnail-placeholder"
      aria-hidden="true"
    >
      {asset.media_kind === "video" ? "🎞" : "🖼"}
    </span>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  useLocale();
  return (
    <section id={id} className="travel-card grid gap-3 [&_h2]:m-0 [&_h3]:m-0 [&_p]:m-0">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
