import { useEffect, type ReactNode } from "react";

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
export type PreviewResources = {
  images: Record<string, string>;
  openFile: (id: string) => void;
  openNavigation: (id: string) => void;
};

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

function storyDate(item: ProjectionItem): string | null {
  const value = text(item, "story_date");
  const precisionValue = text(item, "date_precision") ?? ({ 4: "year", 7: "month", 10: "day" } as Record<number, string>)[value?.length ?? 0];
  if (!value || !/^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(value)) return null;
  if ((precisionValue === "day" && value.length !== 10) || (precisionValue === "month" && value.length !== 7) || (precisionValue === "year" && value.length !== 4)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (month && (month < 1 || month > 12)) return null;
  if (day && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return null;
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "UTC", year: "numeric", ...(precisionValue !== "year" ? { month: "long" as const } : {}), ...(precisionValue === "day" ? { day: "numeric" as const } : {}) }).format(date);
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
  if (empty && !projection.summary) return <section className="card" role="status"><h2>Nog geen gedeelde inhoud</h2><p>Voor deze reis is nog geen inhoud geselecteerd.</p></section>;

  return <div className="visitor-content">
    {projection.summary && <section className="card"><h2>Reisoverzicht</h2><p>{projection.summary}</p></section>}
    {empty && <section className="card" role="status"><h2>Nog geen gedeeld verhaal of foto’s</h2><p>Er zijn nog geen momenten of foto’s geselecteerd.</p></section>}
    <ResourceSection title="Etappes" items={projection.route_stages} render={(item) => <article><h3>{text(item, "label") ?? "Etappe"}</h3>{typeof item.position === "number" && Number.isFinite(item.position) && <p>Etappe {item.position}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Plaatsen" items={projection.places} render={(item) => <article><h3>{text(item, "label") ?? "Plaats"}</h3>{[text(item, "region"), text(item, "country_code")].filter(Boolean).length > 0 && <p>{[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}</p>}{navigationLink(item)}</article>} />
    <Story moments={projection.moments} media={projection.media} fileUrl={fileUrl} navigationLink={navigationLink} />
    <ResourceSection title="Verblijven" items={projection.stays} render={(item) => <article><h3>{text(item, "title") ?? "Verblijf"}</h3>{precision(item) && <p>{precision(item)}</p>}{place(item.place) && <p>{place(item.place)}</p>}{navigationLink(item)}</article>} />
    <ResourceSection title="Routes" items={projection.route} render={(item) => <article><h3>{text(item, "label") ?? "Route"}</h3>{precision(item) && <p>{precision(item)}</p>}{Object.hasOwn(item, "geometry") && <RouteLine geometry={item.geometry} />}</article>} />
    {looseMedia.length > 0 && <section className="card visitor-section"><h2>Galerij</h2><Gallery items={looseMedia} fileUrl={fileUrl} title="Gedeelde foto’s" /></section>}
    <ResourceSection title="Documenten" items={projection.documents} render={(item) => <article><h3>{text(item, "title") ?? "Gedeeld document"}</h3>{hasFileMarker(item, "file") && (previewResources ? <button className="visitor-resource-action" type="button" onClick={() => previewResources.openFile(item.id)}>Document downloaden</button> : <a href={fileUrl(item) ?? undefined} referrerPolicy="no-referrer" rel="noreferrer">Document openen</a>)}</article>} />
    {projection.navigation.some((item) => !displayed.has(item.id)) && <ResourceSection title="Navigatie" items={projection.navigation.filter((item) => !displayed.has(item.id))} render={(item) => <article><h3>Bestemming</h3>{navigationLink(item)}</article>} />}
  </div>;
}
