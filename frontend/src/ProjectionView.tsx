import { useEffect, useMemo, type ReactNode } from "react";
import { TripMap, type MapLine, type MapPoint } from "./TripMap";

export type ProjectionItem = { id: string; [field: string]: unknown };

export type Projection = {
  schema_version: string;
  title: string | null;
  summary: string | null;
  dates: ProjectionItem | null;
  highlights: ProjectionItem[];
  route_stages: ProjectionItem[];
  places: ProjectionItem[];
  moments: ProjectionItem[];
  stays: ProjectionItem[];
  media: ProjectionItem[];
  documents: ProjectionItem[];
  route: ProjectionItem[];
  navigation: ProjectionItem[];
};

export type Audience = "public" | "share";
export type PreviewResources = {
  images: Record<string, string>;
  openFile: (id: string) => void;
  openNavigation: (id: string) => void;
};

const collections = ["highlights", "route_stages", "places", "moments", "stays", "media", "documents", "route", "navigation"] as const;
const navigableCollections = ["route_stages", "places", "moments", "stays"] as const;

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

export function projectionMapLines(projection: Projection): MapLine[] {
  return projection.route.flatMap((item) => {
    const geometry = item.geometry;
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return [];
    const line = geometry as { type?: unknown; coordinates?: unknown };
    if (line.type !== "LineString" || !Array.isArray(line.coordinates) || line.coordinates.length < 2 || !line.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => typeof value === "number" && Number.isFinite(value)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) return [];
    return [{ id: item.id, label: text(item, "label") ?? "Route", coordinates: line.coordinates as [number, number][] }];
  });
}

export function projectionMapPoints(projection: Projection): MapPoint[] {
  const point = (item: ProjectionItem, place: unknown): MapPoint[] => {
    if (!place || typeof place !== "object" || Array.isArray(place)) return [];
    const values = place as Record<string, unknown>;
    const latitude = values.latitude, longitude = values.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
    return [{ id: item.id, label: text(item, "label") ?? (typeof values.label === "string" ? values.label : "Plaats"), coordinates: [longitude, latitude] }];
  };
  return [...projection.places.flatMap((item) => point(item, item)), ...projection.route_stages.flatMap((item) => point(item, item.place))];
}

function Gallery({ items, fileUrl, title = "Galerij" }: { items: ProjectionItem[]; fileUrl: (item: ProjectionItem) => string | null; title?: string }) {
  if (!items.length) return null;
  return <section className="visitor-gallery" aria-label={title}><h3>{title}</h3><ul>{items.map((item) => <li key={item.id}><figure>
    {hasFileMarker(item, "image") && (fileUrl(item) ? <img src={fileUrl(item)!} alt={text(item, "alt_text") ?? "Gedeelde afbeelding"} width={positiveSize(item, "width")} height={positiveSize(item, "height")} style={{ objectPosition: `${focus(item, "focal_x")}% ${focus(item, "focal_y")}%` }} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <p role="status">Afbeelding laden of niet beschikbaar.</p>)}
    {text(item, "caption") && <figcaption>{text(item, "caption")}</figcaption>}
  </figure></li>)}</ul></section>;
}

function Story({ moments, media, fileUrl, navigationLink }: { moments: ProjectionItem[]; media: ProjectionItem[]; fileUrl: (item: ProjectionItem) => string | null; navigationLink: (item: ProjectionItem) => ReactNode }) {
  if (!moments.length) return null;
  return <section className="card visitor-section visitor-story" aria-label="Reisverhaal"><h2>Reisverhaal</h2>
    <nav aria-label="Momenten in dit verhaal"><ol>{moments.map((item) => <li key={item.id}><a href={`#moment-${item.id}`}>{text(item, "title") ?? storyDate(item) ?? "Moment"}</a></li>)}</ol></nav>
    <ol className="visitor-timeline">{moments.map((item) => <li key={item.id} id={`moment-${item.id}`} tabIndex={-1}><article>
      <div className="visitor-moment-meta">{storyDate(item) ? <time dateTime={text(item, "story_date") ?? undefined}>{storyDate(item)}</time> : precision(item) ? <span>{precision(item)}</span> : null}{place(item.place) && <span>{place(item.place)}</span>}</div>
      <h3>{text(item, "title") ?? "Moment"}</h3>{text(item, "body") && <p>{text(item, "body")}</p>}{navigationLink(item)}
      <Gallery items={media.filter((image) => image.moment === item.id)} fileUrl={fileUrl} title="Foto’s bij dit moment" />
    </article></li>)}</ol>
  </section>;
}

export function ProjectionView({ projection, audience, identifier, previewResources }: { projection: Projection; audience: Audience; identifier: string; previewResources?: PreviewResources }) {
  const mapLines = useMemo(() => projectionMapLines(projection), [projection]);
  const mapPoints = useMemo(() => projectionMapPoints(projection), [projection]);
  useEffect(() => {
    if (previewResources) return;
    const fragment = window.location.hash.slice(1);
    if (!projection.moments.some((item) => fragment === `moment-${item.id}`)) return;
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
  const momentIds = new Set(projection.moments.map((item) => item.id));
  const looseMedia = projection.media.filter((item) => typeof item.moment !== "string" || !momentIds.has(item.moment));
  const empty = collections.every((key) => projection[key].length === 0);
  const dates = tripDates(projection.dates);
  if (empty && !projection.summary && !dates) return <section className="card" role="status"><h2>Nog geen gedeelde inhoud</h2><p>Voor deze reis is nog geen inhoud geselecteerd.</p></section>;

  return <div className="visitor-content">
    {(projection.summary || dates) && <section className="card"><h2>Reisoverzicht</h2>{dates && <p className="eyebrow">{dates}</p>}{projection.summary && <p>{projection.summary}</p>}</section>}
    <ResourceSection title="Hoogtepunten" items={projection.highlights} render={(item) => <article><h3>{text(item, "title") ?? "Hoogtepunt"}</h3>{text(item, "summary") && <p>{text(item, "summary")}</p>}</article>} />
    {(mapLines.length > 0 || mapPoints.length > 0) && <TripMap points={mapPoints} lines={mapLines} />}
    {empty && <section className="card" role="status"><h2>Nog geen gedeeld verhaal of foto’s</h2><p>Er zijn nog geen momenten of foto’s geselecteerd.</p></section>}
    <ResourceSection title="Etappes" items={projection.route_stages} render={(item) => <article><h3>{text(item, "label") ?? "Etappe"}</h3>{typeof item.position === "number" && Number.isFinite(item.position) && <p>Etappe {item.position + 1}</p>}{text(item, "summary") && <p>{text(item, "summary")}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Plaatsen" items={projection.places} render={(item) => <article><h3>{text(item, "label") ?? "Plaats"}</h3>{[text(item, "region"), text(item, "country_code")].filter(Boolean).length > 0 && <p>{[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}</p>}{navigationLink(item)}</article>} />
    <Story moments={projection.moments} media={projection.media} fileUrl={fileUrl} navigationLink={navigationLink} />
    <ResourceSection title="Verblijven" items={projection.stays} render={(item) => <article><h3>{text(item, "title") ?? "Verblijf"}</h3>{precision(item) && <p>{precision(item)}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Routes" items={projection.route} render={(item) => <article><h3>{text(item, "label") ?? "Route"}</h3>{precision(item) && <p>{precision(item)}</p>}</article>} />
    {looseMedia.length > 0 && <section className="card visitor-section"><h2>Galerij</h2><Gallery items={looseMedia} fileUrl={fileUrl} title="Gedeelde foto’s" /></section>}
    <ResourceSection title="Documenten" items={projection.documents} render={(item) => <article><h3>{text(item, "title") ?? "Gedeeld document"}</h3>{hasFileMarker(item, "file") && (previewResources ? <button className="visitor-resource-action" type="button" onClick={() => previewResources.openFile(item.id)}>Document downloaden</button> : <a href={fileUrl(item) ?? undefined} referrerPolicy="no-referrer" rel="noreferrer">Document openen</a>)}</article>} />
    {projection.navigation.some((item) => !displayed.has(item.id)) && <ResourceSection title="Navigatie" items={projection.navigation.filter((item) => !displayed.has(item.id))} render={(item) => <article><h3>Bestemming</h3>{navigationLink(item)}</article>} />}
  </div>;
}
