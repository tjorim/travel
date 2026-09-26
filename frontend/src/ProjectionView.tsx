import { useEffect, useMemo, type ReactNode } from "react";
import { Markdown } from "./Markdown";
import { TripMap, type MapLine, type MapPoint } from "./TripMap";
import { ROUTE_MODE_LABELS, timeForViewer, zoneName, type RouteMode } from "./tracker-model";

export type ProjectionItem = { id: string; [field: string]: unknown };

export type Projection = {
  schema_version: string;
  title: string | null;
  /** Markdown source; `summary_html` is its sanitized rendering and `summary_text` a one-line preview. */
  summary: string | null;
  summary_html?: string | null;
  summary_text?: string | null;
  dates: ProjectionItem | null;
  visits: ProjectionItem[];
  places: ProjectionItem[];
  updates: ProjectionItem[];
  stays: ProjectionItem[];
  media: ProjectionItem[];
  routes: ProjectionItem[];
  navigation: ProjectionItem[];
};

export type Audience = "public" | "share";
export type PreviewResources = {
  images: Record<string, string>;
  openFile: (id: string) => void;
  openNavigation: (id: string) => void;
};

const collections = ["visits", "places", "updates", "stays", "media", "routes", "navigation"] as const;
const navigableCollections = ["places", "stays"] as const;

export function isProjection(value: unknown, audience: Audience): value is Projection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return document.schema_version === (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1")
    && (document.title === null || typeof document.title === "string")
    && (document.summary === null || typeof document.summary === "string")
    && (document.summary_html == null || typeof document.summary_html === "string")
    && (document.summary_text == null || typeof document.summary_text === "string")
    && (document.dates === null || (!!document.dates && typeof document.dates === "object" && !Array.isArray(document.dates)))
    && collections.every((key) => Array.isArray(document[key]) && (document[key] as unknown[]).every(
      (item) => item !== null && typeof item === "object" && !Array.isArray(item) && typeof (item as ProjectionItem).id === "string",
    ));
}

function text(item: ProjectionItem, field: string): string | null {
  return typeof item[field] === "string" && item[field] ? item[field] as string : null;
}

function place(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as ProjectionItem;
  return [text(item, "label"), text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ") || null;
}

function precision(item: ProjectionItem): string | null {
  const value = text(item, "date_precision");
  return value === "day" ? "Dagprecisie" : value === "month" ? "Maandprecisie" : value === "year" ? "Jaarprecisie" : null;
}

function transportPlace(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as ProjectionItem;
  const area = [text(item, "label"), text(item, "region")];
  return area.some(Boolean)
    ? [...area, text(item, "country_code")].filter(Boolean).join(" · ")
    : ([text(item, "locality"), text(item, "country_code")].filter(Boolean).join(" · ") || null);
}

function transportTime(item: ProjectionItem, endpoint: "departure" | "arrival"): string | null {
  const value = text(item, endpoint === "departure" ? "departs_at" : "arrives_at");
  if (!value || Number.isNaN(Date.parse(value))) return null;
  const timeZone = text(item, endpoint === "departure" ? "departure_timezone" : "arrival_timezone");
  try {
    return new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }
}

const transportKinds: Record<string, string> = { ...ROUTE_MODE_LABELS, other: "Vervoer" };
const transportStatuses: Record<string, string> = { planned: "Gepland", booked: "Geboekt", confirmed: "Bevestigd", cancelled: "Geannuleerd" };

function storyDate(item: ProjectionItem, field = "story_date"): string | null {
  const value = text(item, field);
  const precisionValue = text(item, "date_precision") ?? ({ 4: "year", 7: "month", 10: "day" } as Record<number, string>)[value?.length ?? 0];
  if (!value || !/^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(value)) return null;
  if ((precisionValue === "day" && value.length !== 10) || (precisionValue === "month" && value.length !== 7) || (precisionValue === "year" && value.length !== 4)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (month && (month < 1 || month > 12)) return null;
  if (day && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return null;
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "UTC", year: "numeric", ...(precisionValue !== "year" ? { month: "long" as const } : {}), ...(precisionValue === "day" ? { day: "numeric" as const } : {}) }).format(date);
}

/** "november 2026 – december 2026" at whatever precision the owner shared. */
export function tripDates(dates: ProjectionItem | null | undefined): string | null {
  if (!dates) return null;
  const [start, end] = [storyDate(dates, "starts_on"), storyDate(dates, "ends_on")];
  return start && end && start !== end ? `${start} – ${end}` : start ?? end;
}

/** A shared visit time: local at the visit, with the viewer's own time when that differs. */
export function visitTimes(item: ProjectionItem): string | null {
  const start = text(item, "start_time");
  if (!start) return null;
  const end = text(item, "end_time");
  const zone = text(item, "timezone");
  const date = text(item, "starts_on");
  const local = `${start}${end ? `–${end}` : ""}${zone ? ` (${zoneName(zone)})` : ""}`;
  const there = zone && date ? timeForViewer(date, start, zone) : null;
  if (!there) return local;
  const thereEnd = end && zone && date ? timeForViewer(date, end, zone) : null;
  const day = there.days === 1 ? " (volgende dag)" : there.days === -1 ? " (vorige dag)" : "";
  return `${local} · bij jou ${there.time}${thereEnd ? `–${thereEnd.time}` : ""}${day}`;
}

function positiveSize(item: ProjectionItem, field: "width" | "height"): number | undefined {
  const value = item[field];
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4000 ? value : undefined;
}

function focus(item: ProjectionItem, field: "focal_x" | "focal_y"): number {
  const value = item[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : 50;
}

function hasFileMarker(item: ProjectionItem, field: "image" | "video" | "file"): boolean {
  const marker = item[field];
  return !!marker && typeof marker === "object" && !Array.isArray(marker) && (marker as { id?: unknown }).id === item.id;
}

function ResourceSection({ title, items, render }: { title: string; items: ProjectionItem[]; render: (item: ProjectionItem) => ReactNode }) {
  if (!items.length) return null;
  return <section className="card visitor-section" aria-label={title}><h2>{title}</h2><ul className="visitor-items">{items.map((item) => <li key={item.id}>{render(item)}</li>)}</ul></section>;
}

function routeHeading(item: ProjectionItem): string {
  return text(item, "label") ?? ([text(item, "carrier"), text(item, "service_reference")].filter(Boolean).join(" · ") || transportKinds[text(item, "mode") ?? ""] || "Route");
}

function RouteSummary({ item }: { item: ProjectionItem }) {
  const departure = transportPlace(item.departure);
  const arrival = transportPlace(item.arrival);
  const departsAt = transportTime(item, "departure");
  const arrivesAt = transportTime(item, "arrival");
  const mode = transportKinds[text(item, "mode") ?? ""];
  const carrier = [text(item, "carrier"), text(item, "service_reference")].filter(Boolean).join(" · ");
  return <article><h3>{routeHeading(item)}</h3>{(departure || arrival) && <p>{departure ?? "Vertrek onbekend"} → {arrival ?? "Aankomst onbekend"}</p>}<p>{[mode, carrier || null, text(item, "status") ? transportStatuses[text(item, "status")!] ?? text(item, "status") : null].filter(Boolean).join(" · ")}</p>{(departsAt || arrivesAt) && <p>{departsAt ?? "Vertrektijd onbekend"} → {arrivesAt ?? "Aankomsttijd onbekend"}</p>}</article>;
}

const transportMode = (value: string | null | undefined): RouteMode => value && value in ROUTE_MODE_LABELS ? value as RouteMode : "other";

const validPoint = (values: Record<string, unknown>): [number, number] | null => {
  const { latitude, longitude } = values;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return [longitude, latitude];
};

/** A route's line: the owner's drawn one, else a straight one between its two ends (a shared location, else its area). */
function routeLines(projection: Projection): MapLine[] {
  return projection.routes.flatMap((item) => {
    if (text(item, "status") === "cancelled") return [];
    const transport = transportMode(text(item, "mode"));
    const geometry = item.geometry;
    if (geometry && typeof geometry === "object" && !Array.isArray(geometry)) {
      const line = geometry as { type?: unknown; coordinates?: unknown };
      if (line.type === "LineString" && Array.isArray(line.coordinates) && line.coordinates.length >= 2 && line.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number" && Number.isFinite(value)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) {
        return [{ id: item.id, label: routeHeading(item), coordinates: line.coordinates as [number, number][], transport }];
      }
    }
    const end = (endpoint: "departure" | "arrival") => {
      const location = routeLocationPoint(item, endpoint);
      if (location) return { coordinates: location.coordinates, label: location.label };
      const area = item[endpoint];
      if (!area || typeof area !== "object" || Array.isArray(area)) return null;
      const coordinates = validPoint(area as Record<string, unknown>);
      return coordinates ? { coordinates, label: text(area as ProjectionItem, "label") ?? "" } : null;
    };
    const departure = end("departure"), arrival = end("arrival");
    if (!departure || !arrival) return [];
    return [{ id: `route-${item.id}`, label: routeHeading(item), coordinates: [departure.coordinates, arrival.coordinates], transport, from: departure.label, to: arrival.label }];
  });
}

export function projectionMapLines(projection: Projection): MapLine[] {
  return routeLines(projection);
}

export function projectionMapPoints(projection: Projection): MapPoint[] {
  const point = (item: ProjectionItem, place: unknown): MapPoint[] => {
    if (!place || typeof place !== "object" || Array.isArray(place)) return [];
    const values = place as Record<string, unknown>;
    const latitude = values.latitude, longitude = values.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{ id: item.id, label: text(item, "label") ?? (typeof values.label === "string" ? values.label : "Locatie"), coordinates: [longitude, latitude] }];
  };
  const points = [...projection.places.flatMap((item) => point(item, item)), ...projection.visits.flatMap((item) => [...point(item, item.place), ...point({ ...item, id: `${item.id}-location`, label: undefined }, item.location)]), ...projection.routes.flatMap((item) => [routeLocationPoint(item, "departure"), routeLocationPoint(item, "arrival")].filter((value): value is MapPoint => value !== null))];
  return [...new Map(points.map((value) => [`${value.coordinates.join(",")}:${value.label}`, value])).values()];
}

function routeLocationPoint(item: ProjectionItem, endpoint: "departure" | "arrival"): MapPoint | null {
  const map = item.map;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const point = (map as Record<string, unknown>)[endpoint];
  if (!point || typeof point !== "object" || Array.isArray(point)) return null;
  const values = point as Record<string, unknown>;
  const latitude = values.latitude, longitude = values.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { id: `transport-${item.id}-${endpoint}`, label: typeof values.label === "string" && values.label ? values.label : endpoint === "departure" ? "Vertrekpunt" : "Aankomstpunt", coordinates: [longitude, latitude], kind: values.kind === "airport" ? "airport" : "place" };
}

function Gallery({ items, fileUrl, title = "Galerij" }: { items: ProjectionItem[]; fileUrl: (item: ProjectionItem) => string | null; title?: string }) {
  if (!items.length) return null;
  return <section className="visitor-gallery" aria-label={title}><h3>{title}</h3><ul>{items.map((item) => <li key={item.id}><figure>
    {hasFileMarker(item, "image") && (fileUrl(item) ? <img src={fileUrl(item)!} alt={text(item, "alt_text") ?? "Gedeelde afbeelding"} width={positiveSize(item, "width")} height={positiveSize(item, "height")} style={{ objectPosition: `${focus(item, "focal_x")}% ${focus(item, "focal_y")}%` }} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <p role="status">Afbeelding laden of niet beschikbaar.</p>)}
    {hasFileMarker(item, "video") && fileUrl(item) && <video controls preload="none" playsInline poster={fileUrl({ id: `${item.id}-poster` }) ?? undefined} aria-label={text(item, "alt_text") ?? "Gedeelde video"} width={positiveSize(item, "width") ?? undefined} height={positiveSize(item, "height") ?? undefined}><source src={fileUrl(item)!} type="video/mp4" /></video>}
    {text(item, "caption") && <figcaption>{text(item, "caption")}</figcaption>}
  </figure></li>)}</ul></section>;
}

function Updates({ updates, media, fileUrl }: { updates: ProjectionItem[]; media: ProjectionItem[]; fileUrl: (item: ProjectionItem) => string | null }) {
  if (!updates.length) return null;
  return <section className="card visitor-section visitor-story" aria-label="Reisupdates"><h2>Reisupdates</h2>
    <nav aria-label="Updates in dit verhaal"><ol>{updates.map((item) => <li key={item.id}><a href={`#${item.id}`}>{text(item, "title") ?? storyDate(item) ?? "Update"}</a></li>)}</ol></nav>
    <ol className="visitor-timeline">{updates.map((item) => <li key={item.id} id={item.id} tabIndex={-1}><article>
      <div className="visitor-update-meta">{storyDate(item) ? <time dateTime={text(item, "story_date") ?? undefined}>{storyDate(item)}</time> : precision(item) ? <span>{precision(item)}</span> : null}{place(item.place) && <span>{place(item.place)}</span>}</div>
      <h3>{text(item, "title") ?? "Update"}</h3><Markdown html={text(item, "body_html")} text={text(item, "body")} />
      <Gallery items={media.filter((image) => image.update === item.id)} fileUrl={fileUrl} title="Media bij deze update" />
    </article></li>)}</ol>
  </section>;
}

export function ProjectionView({ projection, audience, identifier, previewResources }: { projection: Projection; audience: Audience; identifier: string; previewResources?: PreviewResources }) {
  const mapLines = useMemo(() => projectionMapLines(projection), [projection]);
  const mapPoints = useMemo(() => projectionMapPoints(projection), [projection]);
  useEffect(() => {
    if (previewResources) return;
    const fragment = window.location.hash.slice(1);
    if (!projection.updates.some((item) => fragment === item.id)) return;
    const target = document.getElementById(fragment);
    target?.scrollIntoView?.();
    target?.focus({ preventScroll: true });
  }, [projection, previewResources]);
  const navigation = new Set(projection.navigation.map((item) => item.id));
  const displayed = new Set(navigableCollections.flatMap((key) => projection[key].map((item) => item.id)));
  const navigationLink = (item: ProjectionItem) => {
    if (!navigation.has(item.id)) return null;
    if (previewResources) return <button className="visitor-resource-action" type="button" onClick={() => previewResources.openNavigation(item.id)}>Routebeschrijving</button>;
    const base = audience === "public" ? "/api/public/trips" : "/api/shared";
    return <a href={`${base}/${encodeURIComponent(identifier)}/navigation/${encodeURIComponent(item.id)}`} referrerPolicy="no-referrer" rel="noreferrer">Routebeschrijving</a>;
  };
  const fileUrl = (item: ProjectionItem) => previewResources
    ? previewResources.images[item.id] ?? null
    : `${audience === "public" ? "/api/public/trips" : "/api/shared"}/${encodeURIComponent(identifier)}/files/${encodeURIComponent(item.id)}`;
  const updateIds = new Set(projection.updates.map((item) => item.id));
  const looseMedia = projection.media.filter((item) => typeof item.update !== "string" || !updateIds.has(item.update));
  const empty = collections.every((key) => projection[key].length === 0);
  const dates = tripDates(projection.dates);
  if (empty && !projection.summary && !dates) return <section className="card" role="status"><h2>Nog geen gedeelde inhoud</h2><p>Voor deze reis is nog geen inhoud geselecteerd.</p></section>;

  return <div className="visitor-content">
    {(projection.summary || dates) && <section className="card"><h2>Reisoverzicht</h2>{dates && <p className="eyebrow">{dates}</p>}<Markdown html={projection.summary_html} text={projection.summary} /></section>}
    {(mapLines.length > 0 || mapPoints.length > 0) && <TripMap points={mapPoints} lines={mapLines} />}
    {empty && <section className="card" role="status"><h2>Nog geen gedeeld verhaal of foto’s</h2><p>Er zijn nog geen reisupdates of foto’s gedeeld.</p></section>}
    <ResourceSection title="Bezoeken" items={projection.visits} render={(item) => <article><h3>{text(item, "title") ?? "Bezoek"}</h3>{tripDates(item) && <p>{tripDates(item)}</p>}{visitTimes(item) && <p>{visitTimes(item)}</p>}<Markdown html={text(item, "summary_html")} text={text(item, "summary")} />{place(item.place) && <p>{place(item.place)}</p>}</article>} />
    <ResourceSection title="Gebieden en locaties" items={projection.places} render={(item) => <article><h3>{text(item, "label") ?? "Locatie"}</h3>{[text(item, "region"), text(item, "country_code")].filter(Boolean).length > 0 && <p>{[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}</p>}{navigationLink(item)}</article>} />
    <Updates updates={projection.updates} media={projection.media} fileUrl={fileUrl} />
    <ResourceSection title="Verblijven" items={projection.stays} render={(item) => <article><h3>{text(item, "title") ?? "Verblijf"}</h3>{tripDates(item) ? <p>{tripDates(item)}</p> : precision(item) && <p>{precision(item)}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Routes" items={projection.routes} render={(item) => <RouteSummary item={item} />} />
    {looseMedia.length > 0 && <section className="card visitor-section"><h2>Galerij</h2><Gallery items={looseMedia} fileUrl={fileUrl} title="Gedeelde foto’s" /></section>}
    {projection.navigation.some((item) => !displayed.has(item.id)) && <ResourceSection title="Navigatie" items={projection.navigation.filter((item) => !displayed.has(item.id))} render={(item) => <article><h3>Bestemming</h3>{navigationLink(item)}</article>} />}
  </div>;
}
