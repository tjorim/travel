import type { TrackerSession } from "./auth";

export type Place = {
  id: string;
  display_name: string | null;
  osm_element_type: "node" | "way" | "relation" | null;
  osm_element_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  locality: string | null;
  admin_area: string | null;
  postal_code: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  viewport_north: number | null;
  viewport_south: number | null;
  viewport_east: number | null;
  viewport_west: number | null;
  navigation_provider: string | null;
  navigation_provider_place_id: string | null;
  notes: string | null;
};

export type ExactPlaceInput = Partial<Omit<Place, "id">>;
export type PlaceSearchResult = ExactPlaceInput;

export type MediaAsset = {
  id: string;
  media_kind: "photo" | "video";
  byte_size: number;
  content_type: string;
  captured_at: string | null;
  created_at: string;
  original_filename: string | null;
  camera_make: string | null;
  camera_model: string | null;
  gps: { latitude: number; longitude: number } | null;
  file_url: string;
};

export type PlaceSearchResponse = {
  attribution: string;
  attribution_url: string;
  results: PlaceSearchResult[];
};

export type Moment = {
  id: string;
  occurred_at: string;
  title: string;
  story: string;
  place: Place | null;
  media_asset_ids: string[];
};

export type BroadPlace = {
  id: string;
  label: string;
  country_code: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};

export type RouteStage = {
  id: string;
  position: number;
  label: string | null;
  summary: string | null;
  place: BroadPlace;
};

export type TripHighlight = {
  id: string;
  position: number;
  title: string;
  summary: string | null;
};

export type RecordedTrack = {
  id: string;
  started_at: string;
  ended_at: string;
  kind: "gpx" | "point_array";
  byte_size: number;
  content_type: string;
  source_file_url: string;
};

export type BroadRoute = {
  id: string;
  label: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  date_precision: "day" | "month" | "year";
};

export type MomentExcerpt = {
  id: string;
  source_moment_id: string | null;
  broad_place_id: string | null;
  date_precision: "day" | "month" | "year";
  story_date: string | null;
  title: string;
  body: string;
};

export type Trip = {
  id: string;
  title: string;
  summary: string | null;
  starts_on: string | null;
  ends_on: string | null;
  visibility: "private" | "unlisted" | "public";
  publication_state: "draft" | "published";
  route_stages: RouteStage[];
  highlights: TripHighlight[];
  moments: Moment[];
  moment_excerpts: MomentExcerpt[];
};

export type MomentDraft = {
  tripId: string;
  momentId: string | null;
  occurredAt: string;
  title: string;
  story: string;
  place: ExactPlaceInput | null;
  mediaAssetIds: string[];
};

/** The nights at one accommodation: every night from check-in up to, but
 * not including, the check-out morning. Dates and times are local there. */
export type Stay = {
  id: string;
  check_in_date: string;
  check_out_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  status: "planned" | "booked" | "confirmed" | "cancelled";
  property_name: string | null;
  website_url: string | null;
  booking_reference: string | null;
  contact_details: string | null;
  notes: string | null;
  place: Place | null;
  broad_place: BroadPlace | null;
};

export type BroadStayCard = {
  id: string;
  title: string;
  date_precision: "day" | "month" | "year";
  place: BroadPlace;
};

export type TransportLeg = {
  id: string;
  kind: "flight" | "train" | "bus" | "ferry" | "car" | "other";
  status: "planned" | "booked" | "confirmed" | "cancelled";
  departure_place: Place;
  arrival_place: Place;
  departs_at: string;
  arrives_at: string;
  departure_timezone: string | null;
  arrival_timezone: string | null;
  carrier: string | null;
  service_reference: string | null;
  travel_class: string | null;
  booking_reference: string | null;
  notes: string | null;
  document_asset_ids: string[];
};

export type ItineraryLinkKind = "stay" | "transport_leg" | "route_stage" | "place" | "document" | "moment";

export type ItineraryEntryKind = "travel" | "free" | "work";

export type ItineraryEntry = {
  id: string;
  day_date: string | null;
  end_date: string | null;
  kind: ItineraryEntryKind | null;
  tentative: boolean;
  position: number;
  title: string;
  notes: string | null;
  linked_kind: ItineraryLinkKind | null;
  linked_id: string | null;
};

export type TripTask = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  links: TaskLink[];
  completed_at: string | null;
  created_at: string;
};

export type TaskLink = { label: string; url: string };

export type DocumentAsset = {
  id: string;
  document_kind: "booking" | "itinerary" | "receipt" | "other";
  title: string;
  byte_size: number;
  content_type: string;
  original_filename: string | null;
  created_at: string;
  file_url: string;
};

export type DocumentDerivative = {
  id: string;
  document_asset_id: string;
  review_state: "pending" | "approved";
  byte_size: number;
  content_type: string;
  created_at: string;
  file_url: string;
};

export type OwnerDocument = {
  id: string;
  document_kind: "booking" | "itinerary" | "receipt" | "other";
  title: string;
  byte_size: number;
  content_type: string;
  original_filename: string | null;
  linked_trip_id: string | null;
  created_at: string;
  file_url: string;
};

export type EmergencyInfoKind = "contact" | "number" | "medical_note";

export type EmergencyInfoEntry = {
  id: string;
  kind: EmergencyInfoKind;
  label: string;
  value: string;
  notes: string | null;
  created_at: string;
};

export type MediaDerivative = {
  id: string;
  media_asset_id: string;
  purpose: "owner_preview" | "share" | "static_export";
  review_state: "pending" | "approved";
  metadata_stripped_at: string | null;
  width: number | null;
  height: number | null;
  moment_excerpt_id: string | null;
  caption: string | null;
  alt_text: string | null;
  focal_x: number | null;
  focal_y: number | null;
  created_at: string;
  file_url: string;
};

export type VisitCandidate = {
  id: string;
  media_asset_ids: string[];
  starts_at: string | null;
  ends_at: string | null;
  time_options: { media_asset_id: string; captured_at: string }[];
  location_options: { latitude: number; longitude: number; media_asset_ids: string[] }[];
};

export type VisitCandidatesResponse = {
  grouping_window_minutes: number;
  gps_agreement_metres: number;
  candidates: VisitCandidate[];
  unavailable_media_asset_ids: string[];
};

export type VisitCandidateIntent = {
  tripId: string;
  mediaAssetIds: string[];
  occurredAt?: string;
  gps?: { latitude: number; longitude: number };
};

export type ProviderConnectionStatus = {
  provider: "google_photos_picker" | "gopro_cloud";
  connected: boolean;
};

export type ImportSession = {
  id: string;
  provider: ProviderConnectionStatus["provider"];
  state: "pending" | "completed" | "expired";
  picker_uri: string | null;
  expires_at: string | null;
};

export type ImportCompleteResult = {
  ready: boolean;
  imported: MediaAsset[];
  failed: { provider_item_id: string; failure_code: string }[];
};

export type ShareScopeKind = "exact_place" | "route_stage" | "broad_place" | "broad_route" | "moment_excerpt" | "broad_stay_card" | "media_derivative" | "document_derivative" | "trip_highlight";

export type ShareScopeItem = { kind: ShareScopeKind; id: string; fields: string[] };

export type ShareScope = {
  schema_version: "travel/share-scope@1";
  trip: { title: boolean; summary: boolean; dates: "day" | "month" | "year" | null };
  items: ShareScopeItem[];
};

export type PublicProjectionStatus = {
  trip_id: string;
  scope: ShareScope;
  surface_state: "unpublished" | "published";
  slug: string | null;
};

export type ShareLink = {
  id: string;
  label: string;
  state: "draft" | "active" | "revoked" | "expired";
  scope: ShareScope;
  expires_at: string | null;
  created_at: string;
  activated_at: string | null;
  revoked_at: string | null;
};

export type ProjectionDocument = {
  schema_version: string;
  title: string | null;
  summary: string | null;
  dates: Record<string, unknown> | null;
  highlights: Record<string, unknown>[];
  route_stages: Record<string, unknown>[];
  places: Record<string, unknown>[];
  moments: Record<string, unknown>[];
  stays: Record<string, unknown>[];
  media: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  route: Record<string, unknown>[];
  navigation: Record<string, unknown>[];
};

const draftKey = "travel-tracker-moment-draft-v1";

const dayMs = 86_400_000;

/** Add whole days to an ISO calendar date without any time-zone drift. */
export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
}

/** A stay covers the night of ``isoDate`` when it sleeps there that evening. */
export function stayCoversNight(stay: Stay, isoDate: string): boolean {
  return stay.status !== "cancelled" && stay.check_in_date <= isoDate && isoDate < stay.check_out_date;
}

export function formatDay(isoDate: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "UTC", ...options }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function formatDayRange(first: string, last: string | null): string {
  return last && last !== first ? `${formatDay(first)} – ${formatDay(last)}` : formatDay(first);
}

export function stayLabel(stay: Stay): string {
  return stay.property_name ?? `Nog te kiezen${stay.broad_place ? ` in ${stay.broad_place.label}` : ""}`;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function timeZoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? [browserTimeZone()];
}

/** Local wall-clock parts of an instant in an IANA zone (browser zone if null). */
function zonedParts(instant: string, timeZone: string | null): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? undefined, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** ``YYYY-MM-DDTHH:mm`` for a datetime-local input showing the zone's local time. */
export function wallClock(instant: string, timeZone: string | null): string {
  const part = zonedParts(instant, timeZone);
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}`;
}

export function localDate(instant: string, timeZone: string | null): string {
  return wallClock(instant, timeZone).slice(0, 10);
}

/** Minutes a zone is ahead of UTC at an instant, daylight saving included. */
export function utcOffsetMinutes(instant: string, timeZone: string | null): number {
  const minute = Math.floor(Date.parse(instant) / 60_000) * 60_000;
  return Math.round((Date.parse(`${wallClock(new Date(minute).toISOString(), timeZone)}:00Z`) - minute) / 60_000);
}

/** "7 u later dan hier", "1 u 30 min eerder dan hier" or "zelfde tijd als hier". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "zelfde tijd als hier";
  const hours = Math.floor(Math.abs(minutes) / 60), rest = Math.abs(minutes) % 60;
  return `${[hours ? `${hours} u` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ")} ${minutes > 0 ? "later" : "eerder"} dan hier`;
}

export type Whereabouts = { kind: "travel" | "stay" | "between" | "home"; zone: string | null; label: string };

const placeName = (place: Place) => place.locality ?? place.display_name ?? "?";
const stayZone = (stay: Stay) => stay.broad_place?.timezone ?? null;

/** The night an owner is in at an instant, local to a zone: before noon the
 * previous evening's stay still applies (check-out is in the morning). */
function effectiveNight(instant: string, zone: string): string {
  const wall = wallClock(instant, zone);
  return Number(wall.slice(11, 13)) < 12 ? addDays(wall.slice(0, 10), -1) : wall.slice(0, 10);
}

/** Where the plan puts the owner at ``instant``: at home outside the trip
 * (first departure or check-in to last arrival or check-out), otherwise
 * travelling, at a stay, or between stays in the last known zone. */
export function whereabouts(instant: string, stays: Stay[], legs: TransportLeg[], homeZone: string): Whereabouts {
  const now = Date.parse(instant);
  const active = legs.filter((leg) => leg.status !== "cancelled");
  const zoned = stays.filter((stay) => stay.status !== "cancelled" && stayZone(stay));
  const midday = (isoDate: string) => Date.parse(`${isoDate}T12:00:00Z`);
  const bounds = [
    ...active.flatMap((leg) => [Date.parse(leg.departs_at), Date.parse(leg.arrives_at)]),
    ...zoned.flatMap((stay) => [midday(stay.check_in_date), midday(stay.check_out_date)]),
  ];
  const home: Whereabouts = { kind: "home", zone: homeZone, label: "thuis" };
  if (!bounds.length || now < Math.min(...bounds) || now >= Math.max(...bounds)) return home;
  const leg = active.find((candidate) => Date.parse(candidate.departs_at) <= now && now < Date.parse(candidate.arrives_at));
  if (leg) return { kind: "travel", zone: leg.arrival_timezone, label: `onderweg naar ${placeName(leg.arrival_place)}` };
  const current = zoned.find((stay) => stayCoversNight(stay, effectiveNight(instant, stayZone(stay)!)));
  if (current) return { kind: "stay", zone: stayZone(current), label: current.broad_place?.label ?? stayLabel(current) };
  const last = [
    ...active.filter((candidate) => Date.parse(candidate.arrives_at) <= now).map((candidate) => ({ at: Date.parse(candidate.arrives_at), zone: candidate.arrival_timezone, label: placeName(candidate.arrival_place) })),
    // A stay that already began counts as recent up to its check-out.
    ...zoned.filter((stay) => midday(stay.check_in_date) <= now).map((stay) => ({ at: Math.min(now, midday(stay.check_out_date)), zone: stayZone(stay), label: stay.broad_place?.label ?? stayLabel(stay) })),
  ].sort((left, right) => right.at - left.at)[0];
  return last ? { kind: "between", zone: last.zone, label: `tussen verblijven, laatst in ${last.label}` } : home;
}

export function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function emptyDraft(tripId = ""): MomentDraft {
  return { tripId, momentId: null, occurredAt: localDateTime(), title: "", story: "", place: null, mediaAssetIds: [] };
}

export function readDraft(): MomentDraft | null {
  try {
    const value = localStorage.getItem(draftKey);
    if (!value) return null;
    const draft = JSON.parse(value) as Partial<MomentDraft>;
    if (typeof draft.tripId !== "string" || typeof draft.occurredAt !== "string" || typeof draft.title !== "string" || typeof draft.story !== "string") return null;
    return { ...emptyDraft(draft.tripId), ...draft, momentId: typeof draft.momentId === "string" ? draft.momentId : null };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(draftKey);
}

export function saveDraft(draft: MomentDraft): void {
  localStorage.setItem(draftKey, JSON.stringify(draft));
}

export function publicationDescription(trip: Trip): string {
  if (trip.publication_state !== "published" || trip.visibility === "private") return "Privé concept — dit moment is nergens publiek zichtbaar.";
  return trip.visibility === "public" ? "Publieke reis — dit moment wordt na opslaan publiek zichtbaar." : "Verborgen link — dit moment wordt na opslaan via de reislink zichtbaar.";
}

export function apiHeaders(session: TrackerSession): HeadersInit {
  return { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
}

export async function apiError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  throw new Error(body?.detail || fallback);
}

export function bytesLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
}

export async function fetchProtectedFile(session: TrackerSession, fileUrl: string, fallback: string): Promise<Blob> {
  const response = await fetch(fileUrl, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  if (!response.ok) return apiError(response, fallback);
  return response.blob();
}

export function openBlobInNewTab(blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const preview = window.open(objectUrl, "_blank", "noopener");
  if (!preview) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Je browser blokkeerde het openen van het bestand.");
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function openProtectedFile(session: TrackerSession, fileUrl: string, fallback: string): Promise<void> {
  openBlobInNewTab(await fetchProtectedFile(session, fileUrl, fallback));
}
