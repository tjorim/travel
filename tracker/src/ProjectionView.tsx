import type { ReactNode } from "react";

export type ProjectionItem = { id: string; [field: string]: unknown };

export type Projection = {
  schema_version: string;
  title: string | null;
  summary: string | null;
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

const collections = ["route_stages", "places", "moments", "stays", "media", "documents", "route", "navigation"] as const;
const navigableCollections = ["route_stages", "places", "moments", "stays"] as const;

export function isProjection(value: unknown, audience: Audience): value is Projection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return document.schema_version === (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1")
    && (document.title === null || typeof document.title === "string")
    && (document.summary === null || typeof document.summary === "string")
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

function hasFileMarker(item: ProjectionItem, field: "image" | "file"): boolean {
  const marker = item[field];
  return !!marker && typeof marker === "object" && !Array.isArray(marker) && (marker as { id?: unknown }).id === item.id;
}

function RouteLine({ geometry }: { geometry: unknown }) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return null;
  const shape = geometry as { type?: unknown; coordinates?: unknown };
  if (shape.type !== "LineString" || !Array.isArray(shape.coordinates)) return null;
  const coordinates = shape.coordinates.filter((point): point is [number, number] =>
    Array.isArray(point) && point.length === 2 && point.every((number) => typeof number === "number" && Number.isFinite(number)),
  );
  if (coordinates.length < 2 || coordinates.length !== shape.coordinates.length) return null;
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const points = coordinates.map(([x, y]) => `${10 + (maxX === minX ? 50 : 100 * (x - minX) / (maxX - minX))},${110 - (maxY === minY ? 50 : 100 * (y - minY) / (maxY - minY))}`).join(" ");
  return <svg className="visitor-route-line" viewBox="0 0 120 120" role="img" aria-label="Gegeneraliseerde route"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ResourceSection({ title, items, render }: { title: string; items: ProjectionItem[]; render: (item: ProjectionItem) => ReactNode }) {
  if (!items.length) return null;
  return <section className="card visitor-section" aria-label={title}><h2>{title}</h2><ul className="visitor-items">{items.map((item) => <li key={item.id}>{render(item)}</li>)}</ul></section>;
}

export function ProjectionView({ projection, audience, identifier }: { projection: Projection; audience: Audience; identifier: string }) {
  const navigation = new Set(projection.navigation.map((item) => item.id));
  const displayed = new Set(navigableCollections.flatMap((key) => projection[key].map((item) => item.id)));
  const navigationLink = (item: ProjectionItem) => {
    if (!navigation.has(item.id)) return null;
    const base = audience === "public" ? "/api/public/trips" : "/api/shared";
    return <a href={`${base}/${encodeURIComponent(identifier)}/navigation/${encodeURIComponent(item.id)}`} referrerPolicy="no-referrer" rel="noreferrer">Routebeschrijving</a>;
  };
  const fileUrl = (item: ProjectionItem) => `${audience === "public" ? "/api/public/trips" : "/api/shared"}/${encodeURIComponent(identifier)}/files/${encodeURIComponent(item.id)}`;
  const empty = !projection.title && !projection.summary && collections.every((key) => projection[key].length === 0);
  if (empty) return <section className="card" role="status"><h2>Nog geen gedeelde inhoud</h2><p>Voor deze reis is nog geen inhoud geselecteerd.</p></section>;

  return <div className="visitor-content">
    {projection.summary && <section className="card"><h2>Reisoverzicht</h2><p>{projection.summary}</p></section>}
    <ResourceSection title="Etappes" items={projection.route_stages} render={(item) => <article><h3>{text(item, "label") ?? "Etappe"}</h3>{typeof item.position === "number" && Number.isFinite(item.position) && <p>Etappe {item.position}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Plaatsen" items={projection.places} render={(item) => <article><h3>{text(item, "label") ?? "Plaats"}</h3>{[text(item, "region"), text(item, "country_code")].filter(Boolean).length > 0 && <p>{[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Momenten" items={projection.moments} render={(item) => <article><h3>{text(item, "title") ?? "Moment"}</h3>{precision(item) && <p>{precision(item)}</p>}{text(item, "body") && <p>{text(item, "body")}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Verblijven" items={projection.stays} render={(item) => <article><h3>{text(item, "title") ?? "Verblijf"}</h3>{precision(item) && <p>{precision(item)}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Routes" items={projection.route} render={(item) => <article><h3>{text(item, "label") ?? "Route"}</h3>{precision(item) && <p>{precision(item)}</p>}{Object.hasOwn(item, "geometry") && <RouteLine geometry={item.geometry} />}</article>} />
    <ResourceSection title="Media" items={projection.media} render={(item) => <article><h3>Gedeeld medium</h3>{hasFileMarker(item, "image") && <figure className="visitor-media"><img src={fileUrl(item)} alt={text(item, "alt_text") ?? "Gedeelde afbeelding"} loading="lazy" referrerPolicy="no-referrer" />{text(item, "caption") && <figcaption>{text(item, "caption")}</figcaption>}</figure>}{!hasFileMarker(item, "image") && text(item, "caption") && <p>{text(item, "caption")}</p>}</article>} />
    <ResourceSection title="Documenten" items={projection.documents} render={(item) => <article><h3>{text(item, "title") ?? "Gedeeld document"}</h3>{hasFileMarker(item, "file") && <a href={fileUrl(item)} referrerPolicy="no-referrer" rel="noreferrer">Document openen</a>}</article>} />
    {projection.navigation.some((item) => !displayed.has(item.id)) && <ResourceSection title="Navigatie" items={projection.navigation.filter((item) => !displayed.has(item.id))} render={(item) => <article><h3>Bestemming</h3>{navigationLink(item)}</article>} />}
  </div>;
}
