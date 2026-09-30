import { m } from "./paraglide/messages.js";
import { LocaleControl, selectedLocale, useLocale } from "./locale";
import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@base-ui/react/button";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { cn } from "cn";
import { dayjs } from "./dayjs";
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
  return (
    document.schema_version === (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1") &&
    (document.title === null || typeof document.title === "string") &&
    (document.summary === null || typeof document.summary === "string") &&
    (document.summary_html == null || typeof document.summary_html === "string") &&
    (document.summary_text == null || typeof document.summary_text === "string") &&
    (document.dates === null ||
      (!!document.dates && typeof document.dates === "object" && !Array.isArray(document.dates))) &&
    collections.every(
      (key) =>
        Array.isArray(document[key]) &&
        (document[key] as unknown[]).every(
          (item) =>
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as ProjectionItem).id === "string",
        ),
    )
  );
}

function text(item: ProjectionItem, field: string): string | null {
  return typeof item[field] === "string" && item[field] ? (item[field] as string) : null;
}

function place(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as ProjectionItem;
  return [text(item, "label"), text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ") || null;
}

function precision(item: ProjectionItem): string | null {
  const value = text(item, "date_precision");
  return value === "day"
    ? m.visitor_day_precision()
    : value === "month"
      ? m.visitor_month_precision()
      : value === "year"
        ? m.visitor_year_precision()
        : null;
}

function transportPlace(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as ProjectionItem;
  const area = [text(item, "label"), text(item, "region")];
  return area.some(Boolean)
    ? [...area, text(item, "country_code")].filter(Boolean).join(" · ")
    : [text(item, "locality"), text(item, "country_code")].filter(Boolean).join(" · ") || null;
}

function transportTime(item: ProjectionItem, endpoint: "departure" | "arrival"): string | null {
  const value = text(item, endpoint === "departure" ? "departs_at" : "arrives_at");
  if (!value || !dayjs(value).isValid()) return null;
  const timeZone = text(item, endpoint === "departure" ? "departure_timezone" : "arrival_timezone");
  try {
    return dayjs(value)
      .tz(timeZone ?? undefined)
      .locale(selectedLocale())
      .format("D MMM YYYY, HH:mm");
  } catch {
    return dayjs(value).locale(selectedLocale()).format("D MMM YYYY, HH:mm");
  }
}

const transportKinds = (): Record<string, string> => ({ ...ROUTE_MODE_LABELS, other: m.visitor_transport() });
const transportStatuses = (): Record<string, string> => ({
  planned: m.visitor_planned(),
  booked: m.visitor_booked(),
  confirmed: m.visitor_confirmed(),
  cancelled: m.visitor_cancelled(),
});

function storyDate(item: ProjectionItem, field = "story_date"): string | null {
  const value = text(item, field);
  const precisionValue =
    text(item, "date_precision") ??
    ({ 4: "year", 7: "month", 10: "day" } as Record<number, string>)[value?.length ?? 0];
  if (!value || !/^(\d{4}|\d{4}-\d{2}|\d{4}-\d{2}-\d{2})$/.test(value)) return null;
  if (
    (precisionValue === "day" && value.length !== 10) ||
    (precisionValue === "month" && value.length !== 7) ||
    (precisionValue === "year" && value.length !== 4)
  )
    return null;
  const [year, month, day] = value.split("-").map(Number);
  if (month && (month < 1 || month > 12)) return null;
  const yearMonth = dayjs.utc(`${year}-${String(month ?? 1).padStart(2, "0")}-01`);
  if (day && (day < 1 || day > yearMonth.daysInMonth())) return null;
  const date = (day ? yearMonth.date(day) : yearMonth).locale(selectedLocale());
  return precisionValue === "year"
    ? date.format("YYYY")
    : precisionValue === "month"
      ? date.format("MMMM YYYY")
      : date.format("D MMMM YYYY");
}

/** "november 2026 – december 2026" at whatever precision the owner shared. */
export function tripDates(dates: ProjectionItem | null | undefined): string | null {
  if (!dates) return null;
  const [start, end] = [storyDate(dates, "starts_on"), storyDate(dates, "ends_on")];
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end);
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
  const viewer = `${there.time}${thereEnd ? `–${thereEnd.time}` : ""}`;
  return there.days === 1
    ? m.visitor_time_next({ local, viewer })
    : there.days === -1
      ? m.visitor_time_previous({ local, viewer })
      : m.visitor_time_same({ local, viewer });
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
  return (
    !!marker && typeof marker === "object" && !Array.isArray(marker) && (marker as { id?: unknown }).id === item.id
  );
}

function ResourceSection({
  title,
  items,
  render,
  anchor,
}: {
  title: string;
  items: ProjectionItem[];
  render: (item: ProjectionItem) => ReactNode;
  anchor: string;
}) {
  useLocale();
  if (!items.length) return null;
  return (
    <section className="travel-card" aria-label={title}>
      <h2 className="mb-4.5">{title}</h2>
      <ul className="m-0 grid list-none gap-0 p-0 [&_a]:mt-2.5 [&_a]:inline-block [&_a]:font-bold [&_a]:text-travel-forest [&_a]:underline-offset-3 [&_a:focus-visible]:outline-3 [&_a:focus-visible]:outline-offset-3 [&_a:focus-visible]:outline-travel-focus [&_h3]:mb-1.75 [&_h3]:text-lg [&_p]:my-1.25 [&_p]:wrap-anywhere [&_p]:whitespace-pre-wrap">
        {items.map((item) => (
          <li
            className="border-t border-travel-divider py-4 first:border-0 first:pt-0 last:pb-0"
            key={item.id}
            id={`${anchor}-${item.id}`}
          >
            {render(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function routeHeading(item: ProjectionItem): string {
  return (
    text(item, "label") ??
    ([text(item, "carrier"), text(item, "service_reference")].filter(Boolean).join(" · ") ||
      transportKinds()[text(item, "mode") ?? ""] ||
      m.visitor_route())
  );
}

function RouteSummary({ item }: { item: ProjectionItem }) {
  useLocale();
  const departure = transportPlace(item.departure);
  const arrival = transportPlace(item.arrival);
  const departsAt = transportTime(item, "departure");
  const arrivesAt = transportTime(item, "arrival");
  // A route with a day but no times yet.
  const departsOn = storyDate({ ...item, date_precision: "day" }, "departs_on");
  const mode = transportKinds()[text(item, "mode") ?? ""];
  const carrier = [text(item, "carrier"), text(item, "service_reference")].filter(Boolean).join(" · ");
  return (
    <article>
      <h3>{routeHeading(item)}</h3>
      {(departure || arrival) && (
        <p>
          {departure ?? m.visitor_departure_unknown()} → {arrival ?? m.visitor_arrival_unknown()}
        </p>
      )}
      <p>
        {[
          mode,
          carrier || null,
          text(item, "status") ? (transportStatuses()[text(item, "status")!] ?? text(item, "status")) : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {departsAt || arrivesAt ? (
        <p>
          {departsAt ?? m.visitor_departure_time_unknown()} → {arrivesAt ?? m.visitor_arrival_time_unknown()}
        </p>
      ) : (
        departsOn && <p>{departsOn}</p>
      )}
    </article>
  );
}

const transportMode = (value: string | null | undefined): RouteMode =>
  value && value in ROUTE_MODE_LABELS ? (value as RouteMode) : "other";

const validPoint = (values: Record<string, unknown>): [number, number] | null => {
  const { latitude, longitude } = values;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
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
      if (
        line.type === "LineString" &&
        Array.isArray(line.coordinates) &&
        line.coordinates.length >= 2 &&
        line.coordinates.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((value) => typeof value === "number" && Number.isFinite(value)) &&
            Math.abs(point[0]) <= 180 &&
            Math.abs(point[1]) <= 90,
        )
      ) {
        return [
          { id: item.id, label: routeHeading(item), coordinates: line.coordinates as [number, number][], transport },
        ];
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
    const departure = end("departure"),
      arrival = end("arrival");
    if (!departure || !arrival) return [];
    return [
      {
        id: `route-${item.id}`,
        label: routeHeading(item),
        coordinates: [departure.coordinates, arrival.coordinates],
        transport,
        from: departure.label,
        to: arrival.label,
      },
    ];
  });
}

export function projectionMapLines(projection: Projection): MapLine[] {
  return routeLines(projection);
}

export function projectionMapPoints(projection: Projection): MapPoint[] {
  const point = (item: ProjectionItem, place: unknown): MapPoint[] => {
    if (!place || typeof place !== "object" || Array.isArray(place)) return [];
    const values = place as Record<string, unknown>;
    const latitude = values.latitude,
      longitude = values.longitude;
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      return [];
    return [
      {
        id: item.id,
        label: text(item, "label") ?? (typeof values.label === "string" ? values.label : m.visitor_location()),
        coordinates: [longitude, latitude],
      },
    ];
  };
  const points = [
    ...projection.places.flatMap((item) => point(item, item)),
    ...projection.visits.flatMap((item) => [
      ...point(item, item.place),
      ...point({ ...item, id: `${item.id}-location`, label: undefined }, item.location),
    ]),
    ...projection.routes.flatMap((item) =>
      [routeLocationPoint(item, "departure"), routeLocationPoint(item, "arrival")].filter(
        (value): value is MapPoint => value !== null,
      ),
    ),
  ];
  return [...new Map(points.map((value) => [`${value.coordinates.join(",")}:${value.label}`, value])).values()];
}

function routeLocationPoint(item: ProjectionItem, endpoint: "departure" | "arrival"): MapPoint | null {
  const map = item.map;
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const point = (map as Record<string, unknown>)[endpoint];
  if (!point || typeof point !== "object" || Array.isArray(point)) return null;
  const values = point as Record<string, unknown>;
  const latitude = values.latitude,
    longitude = values.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return {
    id: `transport-${item.id}-${endpoint}`,
    label:
      typeof values.label === "string" && values.label
        ? values.label
        : endpoint === "departure"
          ? m.visitor_departure_point()
          : m.visitor_arrival_point(),
    coordinates: [longitude, latitude],
    kind: values.kind === "airport" ? "airport" : "place",
  };
}

function SharedImage({ item, url }: { item: ProjectionItem; url: string }) {
  useLocale();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alt = text(item, "alt_text") ?? m.visitor_shared_image();
  const image = (expanded: boolean) => (
    <img
      key={`${url}:${attempt}:${expanded}`}
      className={
        expanded
          ? "max-h-travel-lightbox w-full object-contain"
          : "block aspect-4/3 h-auto max-h-90 w-full rounded-travel-media bg-travel-tint object-cover"
      }
      src={url}
      alt={alt}
      width={positiveSize(item, "width")}
      height={positiveSize(item, "height")}
      style={expanded ? undefined : { objectPosition: `${focus(item, "focal_x")}% ${focus(item, "focal_y")}%` }}
      loading={expanded ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      hidden={failed}
    />
  );
  const failure = failed && (
    <div role="status">
      <p>{m.visitor_image_failed()}</p>
      <Button
        type="button"
        onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      >
        {m.retry()}
      </Button>
    </div>
  );
  return (
    <Dialog.Root>
      <Dialog.Trigger
        className="block w-full cursor-pointer rounded-travel-media border-0 bg-transparent p-0 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
        aria-label={m.visitor_open_image({ title: alt })}
      >
        {image(false)}
        {failed && m.visitor_image_failed()}
      </Dialog.Trigger>
      {failure}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-travel-backdrop/50" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup className="max-h-dvh w-full max-w-250 overflow-y-auto rounded-2xl border border-travel-border bg-travel-surface p-4 text-travel-ink shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-4">
              <Dialog.Title>{alt}</Dialog.Title>
              <Dialog.Close>{m.visitor_close_image()}</Dialog.Close>
            </div>
            <LocaleControl embedded />
            <figure className="m-0">
              {image(true)}
              {failure}
              <Markdown as="figcaption" html={text(item, "caption_html")} text={text(item, "caption")} />
            </figure>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SharedVideo({ item, url, poster }: { item: ProjectionItem; url: string; poster?: string }) {
  useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <video
        controls
        preload="none"
        playsInline
        poster={poster}
        aria-label={text(item, "alt_text") ?? m.visitor_shared_video()}
        width={positiveSize(item, "width")}
        height={positiveSize(item, "height")}
        onError={() => setFailed(true)}
      >
        <source src={url} type="video/mp4" onError={() => setFailed(true)} />
      </video>
      {failed && <p role="status">{m.visitor_video_failed()}</p>}
    </>
  );
}

function Gallery({
  items,
  fileUrl,
  title = m.visitor_gallery(),
}: {
  items: ProjectionItem[];
  fileUrl: (item: ProjectionItem) => string | null;
  title?: string;
}) {
  useLocale();
  if (!items.length) return null;
  return (
    <section className="mt-4.5 min-w-0" aria-label={title}>
      <h3 className="mb-3 text-base">{title}</h3>
      <ul className="m-0 grid list-none grid-cols-1 gap-3.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <li className="min-w-0" key={item.id}>
            <figure className="m-0">
              {hasFileMarker(item, "image") &&
                (fileUrl(item) ? (
                  <SharedImage item={item} url={fileUrl(item)!} />
                ) : (
                  <p role="status">{m.visitor_image_loading()}</p>
                ))}
              {hasFileMarker(item, "video") && fileUrl(item) && (
                <SharedVideo
                  item={item}
                  url={fileUrl(item)!}
                  poster={fileUrl({ id: `${item.id}-poster` }) ?? undefined}
                />
              )}
              {hasFileMarker(item, "video") && !fileUrl(item) && <p role="status">{m.visitor_video_loading()}</p>}
              <Markdown
                as="figcaption"
                className="mt-1.75 wrap-anywhere leading-normal text-travel-muted"
                html={text(item, "caption_html")}
                text={text(item, "caption")}
              />
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Updates({
  updates,
  media,
  fileUrl,
}: {
  updates: ProjectionItem[];
  media: ProjectionItem[];
  fileUrl: (item: ProjectionItem) => string | null;
}) {
  useLocale();
  if (!updates.length) return null;
  return (
    <section className="travel-card" aria-label={m.visitor_updates()}>
      <h2 className="mb-4.5">{m.visitor_updates()}</h2>
      <nav aria-label={m.visitor_story_navigation()}>
        <ol className="m-0 mb-6 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
          {updates.map((item) => (
            <li key={item.id}>
              <a
                className="text-sm font-bold text-travel-forest underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
                href={`#${item.id}`}
              >
                {text(item, "title") ?? storyDate(item) ?? m.visitor_update()}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <ol
        aria-label={m.visitor_timeline()}
        className="m-0 grid list-none gap-6 border-l-2 border-travel-border py-0 pr-0 pl-5.5"
      >
        {updates.map((item) => (
          <li className="relative min-w-0 scroll-mt-6" key={item.id} id={item.id} tabIndex={-1}>
            <span aria-hidden="true" className="absolute top-2 -left-7.25 size-3 rounded-full bg-travel-forest" />
            <article>
              <div className="flex flex-wrap gap-x-3.5 gap-y-1.25 text-sm font-bold text-travel-muted">
                {storyDate(item) ? (
                  <time dateTime={text(item, "story_date") ?? undefined}>{storyDate(item)}</time>
                ) : precision(item) ? (
                  <span>{precision(item)}</span>
                ) : null}
                {place(item.place) && <span>{place(item.place)}</span>}
              </div>
              <h3 className="my-1.5 text-xl">{text(item, "title") ?? m.visitor_update()}</h3>
              <Markdown html={text(item, "body_html")} text={text(item, "body")} />
              <Gallery
                items={media.filter((image) => image.update === item.id)}
                fileUrl={fileUrl}
                title={m.visitor_update_media()}
              />
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ProjectionView({
  projection,
  audience,
  identifier,
  previewResources,
}: {
  projection: Projection;
  audience: Audience;
  identifier: string;
  previewResources?: PreviewResources;
}) {
  const locale = useLocale();
  const mapLines = useMemo(
    () =>
      projectionMapLines(projection).map((line) => {
        const route = projection.routes.find((item) => item.id === line.id || `route-${item.id}` === line.id);
        if (!route) return line;
        return {
          ...line,
          from: line.from ?? transportPlace(route.departure) ?? undefined,
          to: line.to ?? transportPlace(route.arrival) ?? undefined,
          dates:
            [
              transportTime(route, "departure") ?? storyDate({ ...route, date_precision: "day" }, "departs_on"),
              transportTime(route, "arrival"),
            ]
              .filter(Boolean)
              .join(" → ") || undefined,
          links: [{ label: m.visitor_view_route(), href: `#route-${route.id}` }],
        };
      }),
    [projection, locale],
  );
  const mapPoints = useMemo(
    () =>
      projectionMapPoints(projection).map((point) => {
        const visit = projection.visits.find((item) => item.id === point.id || `${item.id}-location` === point.id);
        const placeItem = projection.places.find((item) => item.id === point.id);
        const route = projection.routes.find(
          (item) => point.id === `transport-${item.id}-departure` || point.id === `transport-${item.id}-arrival`,
        );
        const matchingPlace = (value: unknown) =>
          !!value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).latitude === point.coordinates[1] &&
          (value as Record<string, unknown>).longitude === point.coordinates[0];
        const relatedVisits = projection.visits.filter(
          (item) => item.id === visit?.id || matchingPlace(item.place) || matchingPlace(item.location),
        );
        const relatedUpdates = projection.updates.filter((item) => matchingPlace(item.place));
        const links = [
          ...(placeItem ? [{ label: m.visitor_view_location(), href: `#place-${placeItem.id}` }] : []),
          ...relatedVisits.map((item) => ({
            label: m.visitor_visit_link({ title: text(item, "title") ?? m.visitor_visit() }),
            href: `#visit-${item.id}`,
          })),
          ...relatedUpdates.map((item) => ({
            label: m.visitor_update_link({ title: text(item, "title") ?? m.visitor_update() }),
            href: `#${item.id}`,
          })),
          ...(route ? [{ label: m.visitor_view_route(), href: `#route-${route.id}` }] : []),
        ];
        return { ...point, dates: visit ? (tripDates(visit) ?? undefined) : undefined, links };
      }),
    [projection, locale],
  );
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
    if (previewResources)
      return (
        <Button
          className="mt-2.5 bg-transparent p-0 text-travel-forest underline underline-offset-3"
          type="button"
          onClick={() => previewResources.openNavigation(item.id)}
        >
          {m.visitor_directions()}
        </Button>
      );
    const base = audience === "public" ? "/api/public/trips" : "/api/shared";
    return (
      <a
        href={`${base}/${encodeURIComponent(identifier)}/navigation/${encodeURIComponent(item.id)}`}
        referrerPolicy="no-referrer"
        rel="noreferrer"
      >
        {m.visitor_directions()}
      </a>
    );
  };
  const fileUrl = (item: ProjectionItem) =>
    previewResources
      ? (previewResources.images[item.id] ?? null)
      : `${audience === "public" ? "/api/public/trips" : "/api/shared"}/${encodeURIComponent(identifier)}/files/${encodeURIComponent(item.id)}`;
  const updateIds = new Set(projection.updates.map((item) => item.id));
  const looseMedia = projection.media.filter((item) => typeof item.update !== "string" || !updateIds.has(item.update));
  const empty = collections.every((key) => projection[key].length === 0);
  const dates = tripDates(projection.dates);
  if (empty && !projection.summary && !dates)
    return (
      <section className="travel-card" role="status">
        <h2>{m.visitor_no_content()}</h2>
        <p>{m.visitor_no_content_description()}</p>
      </section>
    );

  return (
    <div className={cn("grid gap-4.5", previewResources ? "mt-5" : "mt-7.5")}>
      {(projection.summary || dates) && (
        <section className="travel-card">
          <h2>{m.visitor_overview()}</h2>
          {dates && <p className="travel-eyebrow">{dates}</p>}
          <Markdown html={projection.summary_html} text={projection.summary} />
        </section>
      )}
      {(mapLines.length > 0 || mapPoints.length > 0) && <TripMap points={mapPoints} lines={mapLines} />}
      {empty && (
        <section className="travel-card" role="status">
          <h2>{m.visitor_no_story()}</h2>
          <p>{m.visitor_no_story_description()}</p>
        </section>
      )}
      <ResourceSection
        title={m.visitor_visits()}
        anchor="visit"
        items={projection.visits}
        render={(item) => (
          <article>
            <h3>{text(item, "title") ?? m.visitor_visit()}</h3>
            {tripDates(item) && <p>{tripDates(item)}</p>}
            {visitTimes(item) && <p>{visitTimes(item)}</p>}
            <Markdown html={text(item, "summary_html")} text={text(item, "summary")} />
            {place(item.place) && <p>{place(item.place)}</p>}
          </article>
        )}
      />
      <ResourceSection
        title={m.visitor_places()}
        anchor="place"
        items={projection.places}
        render={(item) => (
          <article>
            <h3>{text(item, "label") ?? m.visitor_location()}</h3>
            {[text(item, "region"), text(item, "country_code")].filter(Boolean).length > 0 && (
              <p>{[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}</p>
            )}
            {navigationLink(item)}
          </article>
        )}
      />
      <Updates updates={projection.updates} media={projection.media} fileUrl={fileUrl} />
      <ResourceSection
        title={m.visitor_stays()}
        anchor="stay"
        items={projection.stays}
        render={(item) => (
          <article>
            <h3>{text(item, "title") ?? m.visitor_stay()}</h3>
            {tripDates(item) ? <p>{tripDates(item)}</p> : precision(item) && <p>{precision(item)}</p>}
            {place(item.place) && <p>{place(item.place)}</p>}
            {navigationLink(item)}
          </article>
        )}
      />
      <ResourceSection
        title={m.visitor_routes()}
        anchor="route"
        items={projection.routes}
        render={(item) => <RouteSummary item={item} />}
      />
      {looseMedia.length > 0 && (
        <section className="travel-card">
          <h2 className="mb-4.5">{m.visitor_gallery()}</h2>
          <Gallery items={looseMedia} fileUrl={fileUrl} title={m.visitor_shared_photos()} />
        </section>
      )}
      {projection.navigation.some((item) => !displayed.has(item.id)) && (
        <ResourceSection
          title={m.visitor_navigation()}
          anchor="navigation"
          items={projection.navigation.filter((item) => !displayed.has(item.id))}
          render={(item) => (
            <article>
              <h3>{m.visitor_destination()}</h3>
              {navigationLink(item)}
            </article>
          )}
        />
      )}
    </div>
  );
}
