/**
 * The visitor projection document, as `backend/app/schemas.py` (`ProjectionDocument` and the `Projection*` records)
 * publishes it. These types are written by hand, one to one with those models and in their order; keep them there
 * and nothing else in the app should name a projection field that is not declared here. They are meant to be
 * replaced by the types generated from the OpenAPI schema.
 *
 * A field marked `?` is delivered only under the condition the backend names, so it is absent otherwise; null is a
 * value the server sends on purpose.
 */
import type { CurrentLocation } from "./CurrentLocations";
import type { DatePrecision, RouteMode, VisitorNumbers } from "./tracker-model";

/** What every delivered record carries: its projection-local id, never a canonical one. */
export type ProjectionItem = { id: string };

/** The trip's travel dates at the precision the audience may read. */
export type ProjectionDates = {
  starts_on: string | null;
  ends_on: string | null;
  date_precision: DatePrecision;
};

/** An area embedded in a record: its label, region, country and a point rounded to two decimals. */
export type ProjectionArea = {
  label: string | null;
  country_code: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
};

/** A location's address; only the parts the owner filled in. */
export type ProjectionAddress = {
  line1?: string | null;
  line2?: string | null;
  postal_code?: string | null;
  locality?: string | null;
  admin_area?: string | null;
};

/** A shared area or location: in `places`, and embedded as the `location` of a visit, stay or update. */
export type ProjectionPlace = ProjectionItem &
  ProjectionArea & {
    address?: ProjectionAddress | null;
  };

export type ProjectionVisit = ProjectionItem & {
  title: string | null;
  /** Markdown source; `summary_html` is its sanitized rendering. */
  summary: string | null;
  summary_html: string | null;
  place: ProjectionArea | null;
  date_precision: DatePrecision;
  starts_on?: string | null;
  ends_on?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  location?: ProjectionPlace | null;
};

export type ProjectionStay = ProjectionItem & {
  title: string | null;
  place: ProjectionArea | null;
  date_precision: DatePrecision;
  starts_on: string | null;
  ends_on: string | null;
  location?: ProjectionPlace | null;
};

export type ProjectionUpdate = ProjectionItem & {
  title: string;
  body: string;
  body_html: string | null;
  date_precision: DatePrecision;
  story_date: string | null;
  place: ProjectionArea | null;
  location?: ProjectionPlace | null;
};

/** A projection-local file marker: it discloses no object key, original asset or canonical id. */
export type ProjectionFile = ProjectionItem;

export type ProjectionMedia = ProjectionItem & {
  video?: ProjectionFile | null;
  poster?: ProjectionFile | null;
  duration_seconds?: number | null;
  image?: ProjectionFile | null;
  caption: string | null;
  caption_html: string | null;
  alt_text: string | null;
  width: number | null;
  height: number | null;
  focal_x: number | null;
  focal_y: number | null;
  /** The id of the shared update this photo travels with. */
  update?: string | null;
};

/** The owner's drawn line: longitude, latitude pairs. */
export type ProjectionRouteLine = {
  type: "LineString";
  coordinates: number[][];
};

/** One end of a route on the map, delivered only when that location is itself shared. */
export type ProjectionRoutePoint = {
  label: string;
  country_code: string | null;
  latitude: number;
  longitude: number;
  kind: "airport" | "place";
};

export type ProjectionRouteMap = {
  departure: ProjectionRoutePoint | null;
  arrival: ProjectionRoutePoint | null;
};

export type ProjectionRoute = ProjectionItem & {
  mode: RouteMode;
  /** Planned, confirmed or cancelled; read as an open string so a new status never breaks a page. */
  status: string;
  label: string | null;
  departure: ProjectionArea | null;
  arrival: ProjectionArea | null;
  carrier: string | null;
  service_reference: string | null;
  departs_on?: string | null;
  date_precision?: DatePrecision | null;
  departs_at?: string | null;
  arrives_at?: string | null;
  departure_timezone?: string | null;
  arrival_timezone?: string | null;
  geometry?: ProjectionRouteLine | null;
  map?: ProjectionRouteMap | null;
};

/** A shared place someone may navigate to; directions are fetched by its id. */
export type ProjectionNavigation = ProjectionItem;

export type Projection = {
  current_locations?: CurrentLocation[] | null;
  numbers?: VisitorNumbers;
  schema_version: string;
  title: string | null;
  /** Markdown source; `summary_html` is its sanitized rendering and `summary_text` a one-line preview. */
  summary: string | null;
  summary_html?: string | null;
  summary_text?: string | null;
  dates: ProjectionDates | null;
  /** The id of the `media` photo this audience shows as the cover; absent or null when it receives none. */
  cover?: string | null;
  visits: ProjectionVisit[];
  places: ProjectionPlace[];
  updates: ProjectionUpdate[];
  stays: ProjectionStay[];
  media: ProjectionMedia[];
  routes: ProjectionRoute[];
  navigation: ProjectionNavigation[];
};

/** The dates a record states about itself: its own range, with the precision it was shared at. */
export type DateRange = {
  starts_on?: string | null;
  ends_on?: string | null;
  date_precision?: DatePrecision | null;
};
