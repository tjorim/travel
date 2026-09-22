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
};

export type RouteStage = {
  id: string;
  position: number;
  label: string | null;
  place: BroadPlace;
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
  visibility: "private" | "unlisted" | "public";
  publication_state: "draft" | "published";
  route_stages: RouteStage[];
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

export type Stay = {
  id: string;
  arrives_at: string;
  departs_at: string;
  status: "planned" | "booked" | "confirmed" | "cancelled";
  property_name: string;
  booking_reference: string | null;
  contact_details: string | null;
  notes: string | null;
  place: Place;
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
  carrier: string | null;
  service_reference: string | null;
  booking_reference: string | null;
  notes: string | null;
  document_asset_ids: string[];
};

export type ItineraryLinkKind = "stay" | "transport_leg" | "route_stage" | "place" | "document" | "moment";

export type ItineraryEntry = {
  id: string;
  day_date: string | null;
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
  completed_at: string | null;
  created_at: string;
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

export type ShareScopeKind = "exact_place" | "route_stage" | "broad_place" | "broad_route" | "moment_excerpt" | "broad_stay_card" | "media_derivative" | "document_derivative";

export type ShareScopeItem = { kind: ShareScopeKind; id: string; fields: string[] };

export type ShareScope = {
  schema_version: "travel/share-scope@1";
  trip: { title: boolean; summary: boolean };
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
