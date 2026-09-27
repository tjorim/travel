/** Who receives a record: nobody, every visitor, or only the audiences that list it in Delen. */
export type Visibility = "private" | "everyone" | "custom";

export type Location = {
  id: string;
  visibility: Visibility;
  /** The public name of a location the owner shares; its display name usually contains the address. */
  label: string | null;
  /** The area this location belongs to, derived from its city when it was created. */
  area_id: string;
  /** Show the address too when the location is shared. Off unless the owner chooses it. */
  share_address: boolean;
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
  notes_html?: string | null;
};

/** A location to create, or with `existing_location_id` a location the trip already has (sent on its own). */
export type LocationInput = Partial<Omit<Location, "id" | "visibility" | "area_id" | "share_address">> & { existing_location_id?: string };

/** What the owner calls a location: the first part of its name, never a full address line. */
export const locationName = (place: Partial<Pick<Location, "display_name" | "locality" | "label">>): string => place.label || place.display_name?.split(",")[0]?.trim() || place.locality || "Locatie zonder naam";
export type PlaceSearchResult = LocationInput;

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

export type Area = {
  id: string;
  visibility: Visibility;
  label: string;
  country_code: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string | null;
};

export type AreaSuggestion = { existing_area_id: string | null; area: Pick<Area, "label" | "country_code" | "region" | "latitude" | "longitude" | "timezone"> };

/** How a route is travelled. */
export type RouteMode = "flight" | "train" | "bus" | "ferry" | "car" | "bike" | "walk" | "other";

export const ROUTE_MODE_LABELS: Record<RouteMode, string> = {
  flight: "Vlucht", train: "Trein", bus: "Bus", ferry: "Veerboot", car: "Auto", bike: "Fiets", walk: "Te voet", other: "Anders",
};

/**
 * A reisupdate: what happened, with a private part and a shared part. The private part — `private_notes`,
 * the `location` and the attached originals — is never shared. The title, the `body` written for
 * visitors, the date at `date_precision` and the area are shared only as `visibility` allows.
 */
export type TravelUpdate = {
  id: string;
  occurred_at: string;
  date_precision: "day" | "month" | "year";
  title: string;
  body: string;
  body_html?: string | null;
  private_notes: string | null;
  private_notes_html?: string | null;
  area_id: string | null;
  /** The area of its location, or the direct area of a location-less update. */
  area?: Area | null;
  location: Location | null;
  media_asset_ids: string[];
  visibility: Visibility;
};

export type Trip = {
  id: string;
  title: string;
  summary: string | null;
  summary_html?: string | null;
  starts_on: string | null;
  ends_on: string | null;
  travel_updates: TravelUpdate[];
};

export type UpdateDraft = {
  tripId: string;
  updateId: string | null;
  occurredAt: string;
  title: string;
  /** Private notes: what the owner wants to remember. The text for visitors is written later. */
  notes: string;
  location: LocationInput | null;
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
  /** Plain text with its phone numbers, email and web addresses linked, as sanitized HTML. */
  contact_details_html?: string | null;
  notes: string | null;
  notes_html?: string | null;
  /** Every stay has a location; its area comes from it. */
  location: Location;
  area: Area;
  visibility: Visibility;
  /** How exactly visitors see the nights of a shared stay. */
  share_date_precision: "day" | "month" | "year";
};

/**
 * How the trip gets from one area to another. Only the two areas are required; the day, the exact
 * locations, the schedule, the booking details and a drawn line are optional. A day comes first,
 * the times are an optional second step.
 */
export type Route = {
  id: string;
  mode: RouteMode;
  status: "planned" | "booked" | "confirmed" | "cancelled";
  label: string | null;
  departure_area: Area;
  arrival_area: Area;
  departure_location: Location | null;
  arrival_location: Location | null;
  /** The local day of departure: set before the times are, and always the local date of `departs_at`. */
  departs_on: string | null;
  departs_at: string | null;
  arrives_at: string | null;
  departure_timezone: string | null;
  arrival_timezone: string | null;
  carrier: string | null;
  service_reference: string | null;
  travel_class: string | null;
  booking_reference: string | null;
  notes: string | null;
  notes_html?: string | null;
  document_asset_ids: string[];
  geometry: { type: "LineString"; coordinates: [number, number][] } | null;
  visibility: Visibility;
};

/** A route whose schedule is known. */
export type TimedRoute = Route & { departs_at: string; arrives_at: string };
export const timedRoutes = (routes: Route[]): TimedRoute[] => routes.filter((route): route is TimedRoute => route.departs_at !== null && route.arrives_at !== null);

/** What a route is called: its label, else where it goes. */
export const routeTitle = (route: Pick<Route, "label" | "departure_area" | "arrival_area">): string => route.label ?? `${route.departure_area.label} → ${route.arrival_area.label}`;

/** What kind of days a visit is: free days, or working ones. */
export type VisitKind = "free" | "work";

/** How settled a visit is. Owner-only: never shared, so planning state lives here, not in a label. */
export type VisitStatus = "idea" | "planned" | "confirmed";

/**
 * A stop on the trip: at an area, or at a location in one, and optionally when. The times are local
 * at the visit (the time zone is its area's) and stay private unless `share_time` is set.
 */
export type Visit = {
  id: string;
  position: number;
  area: Area;
  location: Location | null;
  title: string | null;
  kind: VisitKind | null;
  status: VisitStatus;
  starts_on: string | null;
  ends_on: string | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  notes_html?: string | null;
  summary: string | null;
  summary_html?: string | null;
  visibility: Visibility;
  share_time: boolean;
  share_date_precision: "day" | "month" | "year";
};

/** What a visit is called: its title, else its location, else its area. */
export const visitTitle = (visit: Pick<Visit, "title" | "area" | "location">): string => visit.title ?? (visit.location ? locationName(visit.location) : visit.area.label);

export type TripTask = {
  id: string;
  title: string;
  notes: string | null;
  notes_html?: string | null;
  due_date: string | null;
  remind_at: string | null;
  reminded_at: string | null;
  links: TaskLink[];
  completed_at: string | null;
  created_at: string;
};

export type TaskLink = { label: string; url: string };

export type TripTaskAlert = {
  id: string;
  task_id: string;
  kind: "reminder";
  title: string;
  scheduled_for: string;
  created_at: string;
  read_at: string | null;
  email_sent_at: string | null;
  email_attempts: number;
  email_last_error: string | null;
};

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
  /** Sanitized HTML of the Markdown `notes`; `notes_text` is its one-line plain-text preview. */
  notes_html?: string | null;
  notes_text?: string | null;
  created_at: string;
};

export type MediaDerivative = {
  id: string;
  media_asset_id: string;
  purpose: "owner_preview" | "share" | "static_export";
  review_state: "pending" | "approved";
  processing_state?: "processing" | "failed" | "ready";
  media_kind?: "photo" | "video";
  content_type?: string | null;
  byte_size?: number | null;
  duration_seconds?: number | null;
  poster_url?: string | null;
  remove_audio?: boolean;
  metadata_stripped_at: string | null;
  width: number | null;
  height: number | null;
  travel_update_id: string | null;
  caption: string | null;
  /** Sanitized inline HTML of the caption: bold, italic and links only. */
  caption_html?: string | null;
  alt_text: string | null;
  focal_x: number | null;
  focal_y: number | null;
  visibility: Visibility;
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
  /** Whether the server offers it at all; an unavailable provider is not shown. */
  available: boolean;
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

/** Every kind of record that can be shared, and so can carry a visibility. */
export type ShareScopeKind = "area" | "location" | "visit" | "route" | "stay" | "travel_update" | "media_derivative";

/** An audience lists only records whose visibility is custom; which fields show is fixed per kind. */
export type ShareScopeItem = { kind: ShareScopeKind; id: string };

export type ShareScope = {
  schema_version: "travel/share-scope@1";
  trip: { title: boolean; summary: boolean; dates: "day" | "month" | "year" | null };
  items: ShareScopeItem[];
};

/** What one audience (the public page or a draft/active link) receives right now. */
export type OverviewAudience = {
  kind: "public" | "share_link";
  id: string | null;
  label: string;
  state: string;
  live: boolean;
  shares_title: boolean;
  shares_summary: boolean;
  dates_precision: "day" | "month" | "year" | null;
  scope_items: number;
  delivered: Record<"visits" | "places" | "stays" | "routes" | "updates" | "media", number>;
  without_map_point: Record<"visits" | "stays" | "updates", number>;
};

export type OverviewWarning = {
  code: "live_audience_receives_nothing" | "trip_dates_shared" | "planning_marker_visible" | "map_point_withheld" | "undated_visit_duplicates_dated";
  severity: "warning" | "info";
  /** English, for API and MCP clients; the PWA words each code itself. */
  message: string;
  audience: string | null;
  audience_id: string | null;
  text: string | null;
  kind: string | null;
  id: string | null;
};

/** Owner-only review of a trip: counts per kind, who receives what, and what to check before sharing. */
export type TripOverview = {
  trip_id: string;
  counts: Record<string, number>;
  visibility: Record<string, Partial<Record<Visibility, number>>>;
  audiences: OverviewAudience[];
  warnings: OverviewWarning[];
};

export type PublicProjectionStatus = {
  trip_id: string;
  scope: ShareScope;
  surface_state: "unpublished" | "published";
  slug: string | null;
};

export type ShareLink = {
  id: string;
  series_id: string;
  label: string;
  state: "draft" | "active" | "revoked" | "expired";
  scope: ShareScope;
  token: string | null;
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
  visits: Record<string, unknown>[];
  places: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  stays: Record<string, unknown>[];
  media: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  navigation: Record<string, unknown>[];
};

import { dayjs } from "./dayjs";

const draftKey = "travel-tracker-update-draft-v2";

const dayMs = 86_400_000;

/**
 * Add whole days to an ISO calendar date without any time-zone drift. Plain `Date` arithmetic
 * here, not dayjs: this runs in per-night loops (`tripBadges`, `nextAction`) over a trip's full
 * span, and dayjs's object-per-call overhead turns a multi-year trip into a multi-second render.
 */
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

export function formatDay(isoDate: string, format = "D MMM"): string {
  return dayjs.utc(isoDate).format(format);
}

export function formatDayRange(first: string, last: string | null): string {
  return last && last !== first ? `${formatDay(first)} – ${formatDay(last)}` : formatDay(first);
}

export function stayLabel(stay: Stay): string {
  return stay.property_name ?? `Nog te kiezen in ${stay.area.label}`;
}

/** An instant as the app displays it everywhere: "16 nov 2026, 14:32". */
export function formatInstant(instant: string | number): string {
  return dayjs(instant).format("D MMM YYYY, HH:mm");
}

/** An instant's calendar date only, no time: "16 nov 2026". */
export function formatInstantDate(instant: string): string {
  return dayjs(instant).format("D MMM YYYY");
}

/** A reisupdate's date at its own precision, e.g. "14 maart 2026" or just "2026" — never the raw enum. */
export function updateDateLabel(occurredAt: string, precision: TravelUpdate["date_precision"]): string {
  if (precision === "year") return dayjs(occurredAt).format("YYYY");
  if (precision === "month") return dayjs(occurredAt).format("MMMM YYYY");
  return formatInstant(occurredAt);
}

export function browserTimeZone(): string {
  return dayjs.tz.guess();
}

export function timeZoneOptions(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? [browserTimeZone()];
}

/** ``YYYY-MM-DDTHH:mm`` for a datetime-local input showing the zone's local time. */
export function wallClock(instant: string, timeZone: string | null): string {
  return dayjs(instant).tz(timeZone ?? undefined).format("YYYY-MM-DDTHH:mm");
}

export function localDate(instant: string, timeZone: string | null): string {
  return wallClock(instant, timeZone).slice(0, 10);
}

/**
 * A local time at a visit, as a viewer elsewhere would read it: `null` when the viewer's clock says
 * the same, else their time and how many days off their date is (-1, 0 or 1).
 */
export function timeForViewer(date: string, time: string, zone: string, viewerZone = browserTimeZone()): { time: string; days: number } | null {
  try {
    const at = dayjs.tz(`${date}T${time.slice(0, 5)}`, zone);
    if (!at.isValid()) return null;
    const there = at.tz(viewerZone);
    if (there.format("YYYY-MM-DDTHH:mm") === `${date}T${time.slice(0, 5)}`) return null;
    return { time: there.format("HH:mm"), days: daysBetween(date, there.format("YYYY-MM-DD")) };
  } catch {
    return null;
  }
}

/** The city part of an IANA zone name: "Asia/Taipei" reads as "Taipei". */
export const zoneName = (zone: string): string => zone.split("/").pop()?.replaceAll("_", " ") ?? zone;

/** Minutes a zone is ahead of UTC at an instant, daylight saving included. */
export function utcOffsetMinutes(instant: string, timeZone: string | null): number {
  return dayjs(instant).tz(timeZone ?? undefined).utcOffset();
}

/** "7 u later dan hier", "1 u 30 min eerder dan hier" or "zelfde tijd als hier". */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "zelfde tijd als hier";
  const hours = Math.floor(Math.abs(minutes) / 60), rest = Math.abs(minutes) % 60;
  return `${[hours ? `${hours} u` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ")} ${minutes > 0 ? "later" : "eerder"} dan hier`;
}

export type Whereabouts = { kind: "travel" | "stay" | "between" | "home"; zone: string | null; label: string };

const stayZone = (stay: Stay) => stay.area.timezone ?? null;

/** The night an owner is in at an instant, local to a zone: before noon the
 * previous evening's stay still applies (check-out is in the morning). */
function effectiveNight(instant: string, zone: string): string {
  const wall = wallClock(instant, zone);
  return Number(wall.slice(11, 13)) < 12 ? addDays(wall.slice(0, 10), -1) : wall.slice(0, 10);
}

/** Where the plan puts the owner at ``instant``: at home outside the trip
 * (first departure or check-in to last arrival or check-out), otherwise
 * travelling, at a stay, or between stays in the last known zone. */
export function whereabouts(instant: string, stays: Stay[], routes: Route[], homeZone: string): Whereabouts {
  const now = Date.parse(instant);
  const active = timedRoutes(routes).filter((route) => route.status !== "cancelled");
  const zoned = stays.filter((stay) => stay.status !== "cancelled" && stayZone(stay));
  const midday = (isoDate: string) => Date.parse(`${isoDate}T12:00:00Z`);
  const bounds = [
    ...active.flatMap((route) => [Date.parse(route.departs_at), Date.parse(route.arrives_at)]),
    ...zoned.flatMap((stay) => [midday(stay.check_in_date), midday(stay.check_out_date)]),
  ];
  const home: Whereabouts = { kind: "home", zone: homeZone, label: "thuis" };
  if (!bounds.length || now < Math.min(...bounds) || now >= Math.max(...bounds)) return home;
  const route = active.find((candidate) => Date.parse(candidate.departs_at) <= now && now < Date.parse(candidate.arrives_at));
  if (route) return { kind: "travel", zone: route.arrival_timezone, label: `onderweg naar ${route.arrival_area.label}` };
  const current = zoned.find((stay) => stayCoversNight(stay, effectiveNight(instant, stayZone(stay)!)));
  if (current) return { kind: "stay", zone: stayZone(current), label: current.area.label };
  const last = [
    ...active.filter((candidate) => Date.parse(candidate.arrives_at) <= now).map((candidate) => ({ at: Date.parse(candidate.arrives_at), zone: candidate.arrival_timezone, label: candidate.arrival_area.label })),
    // A stay that already began counts as recent up to its check-out.
    ...zoned.filter((stay) => midday(stay.check_in_date) <= now).map((stay) => ({ at: Math.min(now, midday(stay.check_out_date)), zone: stayZone(stay), label: stay.area.label })),
  ].sort((left, right) => right.at - left.at)[0];
  return last ? { kind: "between", zone: last.zone, label: `tussen verblijven, laatst in ${last.label}` } : home;
}

export function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

export function emptyDraft(tripId = ""): UpdateDraft {
  return { tripId, updateId: null, occurredAt: localDateTime(), title: "", notes: "", location: null, mediaAssetIds: [] };
}

/** Drafts are kept per trip, so opening the capture form for one trip never
 * reads or overwrites another trip's unsaved draft. */
function readDraftStore(): Record<string, UpdateDraft> {
  try {
    const value = localStorage.getItem(draftKey);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, UpdateDraft>) : {};
  } catch {
    return {};
  }
}

export function readDraft(tripId: string): UpdateDraft | null {
  const draft = readDraftStore()[tripId] as Partial<UpdateDraft> | undefined;
  if (!draft || typeof draft.occurredAt !== "string" || typeof draft.title !== "string" || typeof draft.notes !== "string") return null;
  return { ...emptyDraft(tripId), ...draft, tripId, updateId: typeof draft.updateId === "string" ? draft.updateId : null };
}

export function clearDraft(tripId: string): void {
  const store = readDraftStore();
  if (!(tripId in store)) return;
  delete store[tripId];
  localStorage.setItem(draftKey, JSON.stringify(store));
}

export function saveDraft(draft: UpdateDraft): void {
  const store = readDraftStore();
  store[draft.tripId] = draft;
  localStorage.setItem(draftKey, JSON.stringify(store));
}

export function bytesLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} kB`;
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
