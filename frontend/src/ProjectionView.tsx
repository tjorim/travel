import { useEffect, useMemo, type ReactNode } from "react";
import { TripMap, type MapLine, type MapPoint } from "./TripMap";

export type ProjectionItem = { id: string; [field: string]: unknown };

export type Projection = {
  schema_version: string;
  title: string | null;
  summary: string | null;
  dates: ProjectionItem | null;
  route_stages: ProjectionItem[];
  places: ProjectionItem[];
  updates: ProjectionItem[];
  stays: ProjectionItem[];
  media: ProjectionItem[];
  documents: ProjectionItem[];
  route: ProjectionItem[];
  transport: ProjectionItem[];
  navigation: ProjectionItem[];
};

export type Audience = "public" | "share";
export type PreviewResources = {
  images: Record<string, string>;
  openFile: (id: string) => void;
  openNavigation: (id: string) => void;
};

const collections = ["route_stages", "places", "updates", "stays", "media", "documents", "route", "transport", "navigation"] as const;
const navigableCollections = ["route_stages", "places", "stays"] as const;

export function isProjection(value: unknown, audience: Audience): value is Projection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return document.schema_version === (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1")
    && (document.title === null || typeof document.title === "string")
    && (document.summary === null || typeof document.summary === "string")
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

const transportKinds: Record<string, string> = { flight: "Vlucht", train: "Trein", bus: "Bus", ferry: "Veerboot", car: "Auto", other: "Vervoer" };
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

function positiveSize(item: ProjectionItem, field: "width" | "height"): number | undefined {
  const value = item[field];
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4000 ? value : undefined;
}

function focus(item: ProjectionItem, field: "focal_x" | "focal_y"): number {
  const value = item[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : 50;
}

function hasFileMarker(item: ProjectionItem, field: "image" | "file"): boolean {
  const marker = item[field];
  return !!marker && typeof marker === "object" && !Array.isArray(marker) && (marker as { id?: unknown }).id === item.id;
}

function ResourceSection({ title, items, render }: { title: string; items: ProjectionItem[]; render: (item: ProjectionItem) => ReactNode }) {
  if (!items.length) return null;
  return <section className="card visitor-section" aria-label={title}><h2>{title}</h2><ul className="visitor-items">{items.map((item) => <li key={item.id}>{render(item)}</li>)}</ul></section>;
}

function TransportSummary({ item }: { item: ProjectionItem }) {
  const departure = transportPlace(item.departure);
  const arrival = transportPlace(item.arrival);
  const departsAt = transportTime(item, "departure");
  const arrivesAt = transportTime(item, "arrival");
  const heading = [text(item, "carrier"), text(item, "service_reference")].filter(Boolean).join(" · ") || transportKinds[text(item, "kind") ?? ""] || "Vervoer";
  return <article><h3>{heading}</h3>{(departure || arrival) && <p>{departure ?? "Vertrek onbekend"} → {arrival ?? "Aankomst onbekend"}</p>}{(departsAt || arrivesAt) && <p>{departsAt ?? "Vertrektijd onbekend"} → {arrivesAt ?? "Aankomsttijd onbekend"}</p>}{text(item, "status") && <p>{transportStatuses[text(item, "status")!] ?? text(item, "status")}</p>}</article>;
}

function mapRouteLines(projection: Projection): MapLine[] {
  return projection.route.flatMap((item) => {
    const geometry = item.geometry;
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return [];
    const line = geometry as { type?: unknown; coordinates?: unknown };
    if (line.type !== "LineString" || !Array.isArray(line.coordinates) || line.coordinates.length < 2 || !line.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number" && Number.isFinite(value)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) return [];
    return [{ id: item.id, label: text(item, "label") ?? "Route", coordinates: line.coordinates as [number, number][] }];
  });
}

function transportMapLines(projection: Projection, points: MapPoint[], routes: MapLine[]): MapLine[] {
  // A selected broad route is the owner's reviewed map representation. There
  // is deliberately no heuristic association to a leg: broad route endpoints
  // may be generalized differently, and a second guessed line is clutter.
  if (routes.length > 0) return [];
  const normalized = (value: string | null) => value?.trim().toLocaleLowerCase("nl-BE") ?? "";
  const broadPointFor = (endpoint: unknown) => {
    if (!endpoint || typeof endpoint !== "object" || Array.isArray(endpoint)) return undefined;
    const endpointLabel = normalized(text(endpoint as ProjectionItem, "label") ?? text(endpoint as ProjectionItem, "locality"));
    return endpointLabel ? points.find((point) => {
      const pointLabel = normalized(point.label);
      return pointLabel === endpointLabel || pointLabel.startsWith(`${endpointLabel} · `);
    }) : undefined;
  };
  return projection.transport.flatMap((item) => {
    if (text(item, "status") === "cancelled") return [];
    const departure = transportMapPoint(item, "departure") ?? broadPointFor(item.departure);
    const arrival = transportMapPoint(item, "arrival") ?? broadPointFor(item.arrival);
    if (!departure || !arrival) return [];
    const kind = text(item, "kind");
    const transport = kind === "train" ? "rail" : kind === "flight" ? "flight" : "road";
    const label = [text(item, "carrier"), text(item, "service_reference")].filter(Boolean).join(" · ") || transportKinds[kind ?? ""] || "Vervoer";
    return [{ id: `transport-${item.id}`, label, coordinates: [departure.coordinates, arrival.coordinates], transport, from: departure.label, to: arrival.label }];
  });
}

export function projectionMapLines(projection: Projection): MapLine[] {
  const routes = mapRouteLines(projection);
  return [...routes, ...transportMapLines(projection, projectionMapPoints(projection), routes)];
}

export function projectionMapPoints(projection: Projection): MapPoint[] {
  const point = (item: ProjectionItem, place: unknown): MapPoint[] => {
    if (!place || typeof place !== "object" || Array.isArray(place)) return [];
    const values = place as Record<string, unknown>;
    const latitude = values.latitude, longitude = values.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{ id: item.id, label: text(item, "label") ?? (typeof values.label === "string" ? values.label : "Plaats"), coordinates: [longitude, latitude] }];
  };
  const points = [...projection.places.flatMap((item) => point(item, item)), ...projection.route_stages.flatMap((item) => point(item, item.place)), ...projection.transport.flatMap((item) => [transportMapPoint(item, "departure"), transportMapPoint(item, "arrival")].filter((value): value is MapPoint => value !== null))];
  return [...new Map(points.map((value) => [`${value.coordinates.join(",")}:${value.label}`, value])).values()];
}

function transportMapPoint(item: ProjectionItem, endpoint: "departure" | "arrival"): MapPoint | null {
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
    {text(item, "caption") && <figcaption>{text(item, "caption")}</figcaption>}
  </figure></li>)}</ul></section>;
}

function Updates({ updates, media, fileUrl }: { updates: ProjectionItem[]; media: ProjectionItem[]; fileUrl: (item: ProjectionItem) => string | null }) {
  if (!updates.length) return null;
  return <section className="card visitor-section visitor-story" aria-label="Reisupdates"><h2>Reisupdates</h2>
    <nav aria-label="Updates in dit verhaal"><ol>{updates.map((item) => <li key={item.id}><a href={`#${item.id}`}>{text(item, "title") ?? storyDate(item) ?? "Update"}</a></li>)}</ol></nav>
    <ol className="visitor-timeline">{updates.map((item) => <li key={item.id} id={item.id} tabIndex={-1}><article>
      <div className="visitor-moment-meta">{storyDate(item) ? <time dateTime={text(item, "story_date") ?? undefined}>{storyDate(item)}</time> : precision(item) ? <span>{precision(item)}</span> : null}{place(item.place) && <span>{place(item.place)}</span>}</div>
      <h3>{text(item, "title") ?? "Update"}</h3>{text(item, "body") && <p>{text(item, "body")}</p>}
      <Gallery items={media.filter((image) => image.update === item.id)} fileUrl={fileUrl} title="Foto’s bij deze update" />
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
    {(projection.summary || dates) && <section className="card"><h2>Reisoverzicht</h2>{dates && <p className="eyebrow">{dates}</p>}{projection.summary && <p>{projection.summary}</p>}</section>}
    {(mapLines.length > 0 || mapPoints.length > 0) && <TripMap points={mapPoints} lines={mapLines} />}
    {empty && <section className="card" role="status"><h2>Nog geen gedeeld verhaal of foto’s</h2><p>Er zijn nog geen reisupdates of foto’s gedeeld.</p></section>}
    <ResourceSection title="Haltes" items={projection.route_stages} render={(item) => <article><h3>{text(item, "label") ?? "Halte"}</h3>{typeof item.position === "number" && Number.isFinite(item.position) && <p>Halte {item.position + 1}</p>}{text(item, "summary") && <p>{text(item, "summary")}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Plaatsen" items={projection.places} render={(item) => <article><h3>{text(item, "label") ?? "Plaats"}</h3>{[text(item, "region"), text(item, "country_code")].filter(Boolean).length > 0 && <p>{[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}</p>}{navigationLink(item)}</article>} />
    <Updates updates={projection.updates} media={projection.media} fileUrl={fileUrl} />
    <ResourceSection title="Verblijven" items={projection.stays} render={(item) => <article><h3>{text(item, "title") ?? "Verblijf"}</h3>{tripDates(item) ? <p>{tripDates(item)}</p> : precision(item) && <p>{precision(item)}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Vervoer" items={projection.transport} render={(item) => <TransportSummary item={item} />} />
    <ResourceSection title="Routes" items={projection.route} render={(item) => <article><h3>{text(item, "label") ?? "Route"}</h3>{precision(item) && <p>{precision(item)}</p>}</article>} />
    {looseMedia.length > 0 && <section className="card visitor-section"><h2>Galerij</h2><Gallery items={looseMedia} fileUrl={fileUrl} title="Gedeelde foto’s" /></section>}
    <ResourceSection title="Documenten" items={projection.documents} render={(item) => <article><h3>{text(item, "title") ?? "Gedeeld document"}</h3>{hasFileMarker(item, "file") && (previewResources ? <button className="visitor-resource-action" type="button" onClick={() => previewResources.openFile(item.id)}>Document downloaden</button> : <a href={fileUrl(item) ?? undefined} referrerPolicy="no-referrer" rel="noreferrer">Document openen</a>)}</article>} />
    {projection.navigation.some((item) => !displayed.has(item.id)) && <ResourceSection title="Navigatie" items={projection.navigation.filter((item) => !displayed.has(item.id))} render={(item) => <article><h3>Bestemming</h3>{navigationLink(item)}</article>} />}
  </div>;
}
