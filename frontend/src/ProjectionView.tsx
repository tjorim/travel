import { m } from "./paraglide/messages.js";
import { LocaleControl, selectedLocale, useLocale } from "./locale";
import { Collapsible } from "@/ui/collapsible";
import { Dialog } from "@/ui/dialog";
import { Button } from "@/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "cn";
import { dayjs } from "./dayjs";
import { Markdown } from "./Markdown";
import { TripMap, type MapLine, type MapPhoto, type MapPoint } from "./TripMap";
import { TripHeader, type TripCover } from "./TripHeader";
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
  /** The id of the `media` photo this audience shows as the cover; absent or null when it receives none. */
  cover?: string | null;
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

const collections = [
  "visits",
  "places",
  "updates",
  "stays",
  "media",
  "routes",
  "navigation",
] as const;
const navigableCollections = ["places", "stays"] as const;

export function isProjection(value: unknown, audience: Audience): value is Projection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    document.schema_version ===
      (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1") &&
    (document.title === null || typeof document.title === "string") &&
    (document.cover == null || typeof document.cover === "string") &&
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
  return (
    [text(item, "label"), text(item, "region"), text(item, "country_code")]
      .filter(Boolean)
      .join(" · ") || null
  );
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

const transportKinds = (): Record<string, string> => ({
  ...ROUTE_MODE_LABELS,
  other: m.visitor_transport(),
});
const transportStatuses = (): Record<string, string> => ({
  planned: m.visitor_planned(),
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
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4000
    ? value
    : undefined;
}

function focus(item: ProjectionItem, field: "focal_x" | "focal_y"): number {
  const value = item[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : 50;
}

function hasFileMarker(item: ProjectionItem, field: "image" | "video" | "file"): boolean {
  const marker = item[field];
  return (
    !!marker &&
    typeof marker === "object" &&
    !Array.isArray(marker) &&
    (marker as { id?: unknown }).id === item.id
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
  const carrier = [text(item, "carrier"), text(item, "service_reference")]
    .filter(Boolean)
    .join(" · ");
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
          text(item, "status")
            ? (transportStatuses()[text(item, "status")!] ?? text(item, "status"))
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {departsAt || arrivesAt ? (
        <p>
          {departsAt ?? m.visitor_departure_time_unknown()} →{" "}
          {arrivesAt ?? m.visitor_arrival_time_unknown()}
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
          {
            id: item.id,
            label: routeHeading(item),
            coordinates: line.coordinates as [number, number][],
            transport,
          },
        ];
      }
    }
    const end = (endpoint: "departure" | "arrival") => {
      const location = routeLocationPoint(item, endpoint);
      if (location) return { coordinates: location.coordinates, label: location.label };
      const area = item[endpoint];
      if (!area || typeof area !== "object" || Array.isArray(area)) return null;
      const coordinates = validPoint(area as Record<string, unknown>);
      return coordinates
        ? { coordinates, label: text(area as ProjectionItem, "label") ?? "" }
        : null;
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
        label:
          text(item, "label") ??
          (typeof values.label === "string" ? values.label : m.visitor_location()),
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
  return [
    ...new Map(
      points.map((value) => [`${value.coordinates.join(",")}:${value.label}`, value]),
    ).values(),
  ];
}

function routeLocationPoint(
  item: ProjectionItem,
  endpoint: "departure" | "arrival",
): MapPoint | null {
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

/** Whole days between two updates dated to the day, else null: the story's "3 days later" connector. */
function daysLater(previous: ProjectionItem | undefined, item: ProjectionItem): number | null {
  const [from, to] = [previous, item].map((entry) => {
    // `storyDate` rejects an impossible date and a month or year date, so only a valid day gets a gap.
    const value = entry && storyDate(entry) ? text(entry, "story_date") : null;
    return value?.length === 10 ? dayjs.utc(value) : null;
  });
  if (!from?.isValid() || !to?.isValid()) return null;
  const days = to.diff(from, "day");
  return days > 0 ? days : null;
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
          : "block aspect-4/3 h-auto w-full rounded-travel-media bg-travel-tint object-cover shadow-travel-card"
      }
      src={url}
      alt={alt}
      width={positiveSize(item, "width")}
      height={positiveSize(item, "height")}
      style={
        expanded
          ? undefined
          : { objectPosition: `${focus(item, "focal_x")}% ${focus(item, "focal_y")}%` }
      }
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
        className="block w-full cursor-pointer rounded-travel-media border-0 bg-transparent p-0 text-travel-ink transition duration-150 hover:brightness-105 motion-reduce:transition-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
        aria-label={m.visitor_open_image({ title: alt })}
      >
        {image(false)}
        {failed && m.visitor_image_failed()}
      </Dialog.Trigger>
      {failure}
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-travel-backdrop/50 travel-backdrop-motion" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Popup className="max-h-dvh w-full max-w-250 overflow-y-auto rounded-2xl border border-travel-border bg-travel-surface p-4 text-travel-ink shadow-2xl travel-popup-motion">
            <div className="mb-4 flex items-center justify-between gap-4">
              <Dialog.Title>{alt}</Dialog.Title>
              <Dialog.Close>{m.visitor_close_image()}</Dialog.Close>
            </div>
            <LocaleControl />
            <figure className="m-0">
              {image(true)}
              {failure}
              <Markdown
                as="figcaption"
                html={text(item, "caption_html")}
                text={text(item, "caption")}
              />
            </figure>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SharedVideo({
  item,
  url,
  poster,
}: {
  item: ProjectionItem;
  url: string;
  poster?: string;
}) {
  useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <video
        className="block w-full rounded-travel-media"
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
  heading = true,
  strip = false,
}: {
  items: ProjectionItem[];
  fileUrl: (item: ProjectionItem) => string | null;
  title?: string;
  /** A gallery already under a heading of its own is named for assistive technology only. */
  heading?: boolean;
  /** Lead with the photos: one wide frame, or a row that scrolls sideways and snaps to each photo. */
  strip?: boolean;
}) {
  useLocale();
  const list = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const scrolls = strip && items.length > 1;
  // The arrows hide at either end of the row, which is read from the scroll position as it moves or resizes.
  useEffect(() => {
    const element = list.current;
    if (!scrolls || !element) return;
    const update = () =>
      setEdges({
        start: element.scrollLeft <= 1,
        end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1,
      });
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [scrolls, items.length]);
  function page(direction: -1 | 1) {
    const element = list.current;
    element?.scrollBy?.({
      left: direction * element.clientWidth * 0.8,
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }
  if (!items.length) return null;
  const arrow =
    "absolute top-1/3 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full border border-travel-control-border bg-travel-surface p-0 text-travel-forest shadow-travel-card disabled:hidden";
  return (
    <section className={cn("min-w-0", heading && "mt-6")} aria-label={title}>
      {heading && <h4 className="mb-3 text-base">{title}</h4>}
      <div className="relative">
        {scrolls && (
          <>
            <Button
              type="button"
              className={cn(arrow, "left-2")}
              disabled={edges.start}
              aria-label={m.visitor_previous_photo()}
              onClick={() => page(-1)}
            >
              <ChevronLeftIcon aria-hidden="true" className="size-5" />
            </Button>
            <Button
              type="button"
              className={cn(arrow, "right-2")}
              disabled={edges.end}
              aria-label={m.visitor_next_photo()}
              onClick={() => page(1)}
            >
              <ChevronRightIcon aria-hidden="true" className="size-5" />
            </Button>
          </>
        )}
        <ul
          ref={list}
          className={
            strip
              ? "m-0 flex list-none snap-x snap-mandatory gap-3.5 overflow-x-auto overscroll-x-contain scroll-px-1 p-0 pb-2"
              : "m-0 grid list-none grid-cols-1 gap-3.5 p-0 min-[560px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1500px]:grid-cols-4"
          }
        >
          {items.map((item) => (
            <li
              className={cn(
                "min-w-0",
                strip &&
                  (items.length === 1
                    ? "w-full max-w-170 shrink-0"
                    : "shrink-0 basis-5/6 snap-start min-[680px]:basis-2/3"),
              )}
              key={item.id}
            >
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
                {hasFileMarker(item, "video") && !fileUrl(item) && (
                  <p role="status">{m.visitor_video_loading()}</p>
                )}
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
      </div>
    </section>
  );
}

/**
 * Reports the update the reader has reached: the last one whose top has passed a line a third of the way down the
 * window. Nothing is observed when the map is not beside the story, so a phone does no extra work.
 */
function useActiveUpdate(
  list: React.RefObject<HTMLOListElement | null>,
  enabled: boolean,
  onActive: (id: string | null) => void,
) {
  const report = useRef(onActive);
  report.current = onActive;
  const [wide, setWide] = useState(
    () => window.matchMedia?.("(min-width: 1100px)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(min-width: 1100px)");
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const items = list.current ? Array.from(list.current.children) : [];
    // Narrower than the map-beside-story layout, or without it, nothing is followed: drop any update left over.
    if (!enabled || !wide) {
      report.current(null);
      return;
    }
    if (!items.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((entry) => entry.isIntersecting);
        if (entering.length) report.current(entering[entering.length - 1].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, [enabled, wide, list]);
}

function Updates({
  updates,
  media,
  fileUrl,
  besideMap = false,
  onActive,
}: {
  updates: ProjectionItem[];
  media: ProjectionItem[];
  fileUrl: (item: ProjectionItem) => string | null;
  /** The map sits beside this story on a wide screen, so the story is one column with its index folded away. */
  besideMap?: boolean;
  onActive?: (id: string | null) => void;
}) {
  useLocale();
  const timeline = useRef<HTMLOListElement>(null);
  useActiveUpdate(timeline, besideMap && !!onActive, (id) => onActive?.(id));
  if (!updates.length) return null;
  return (
    <section className="travel-card" aria-label={m.visitor_updates()}>
      <h2 className="mb-6">{m.visitor_updates()}</h2>
      <div className={besideMap ? "grid gap-8" : "travel-story-split"}>
        <Collapsible.Root className={cn("min-w-0", !besideMap && "min-[1100px]:hidden")}>
          <Collapsible.Trigger className="min-h-11 rounded-travel-control bg-transparent px-3 py-2 text-sm font-bold text-travel-forest underline underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus">
            {m.visitor_choose_update()}
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <nav aria-label={m.visitor_story_navigation()} className="pt-4">
              <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 min-[1100px]:flex-col min-[1100px]:gap-y-3">
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
          </Collapsible.Panel>
        </Collapsible.Root>
        {!besideMap && (
          <nav
            aria-label={m.visitor_story_navigation()}
            className="hidden min-w-0 self-start min-[1100px]:block min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:max-h-travel-lightbox min-[1100px]:overflow-y-auto"
          >
            <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 min-[1100px]:flex-col min-[1100px]:gap-y-3">
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
        )}
        <ol
          ref={timeline}
          aria-label={m.visitor_timeline()}
          className="m-0 grid min-w-0 list-none gap-10 border-l-2 border-travel-border py-0 pr-0 pl-6 min-[680px]:gap-12 min-[680px]:pl-8"
        >
          {updates.map((item, index) => (
            <li className="relative min-w-0 scroll-mt-6" key={item.id} id={item.id} tabIndex={-1}>
              <span
                aria-hidden="true"
                className="absolute top-2.5 -left-8.25 size-3 rounded-full bg-travel-forest min-[680px]:-left-10.25"
              />
              {daysLater(updates[index - 1], item) !== null && (
                <p className="mb-3 text-xs font-bold tracking-travel-eyebrow text-travel-muted uppercase">
                  {m.visitor_days_later({ count: daysLater(updates[index - 1], item)! })}
                </p>
              )}
              <article className="grid gap-3">
                <h3 className="m-0 text-travel-card-title leading-tight font-extrabold tracking-tight">
                  {text(item, "title") ?? m.visitor_update()}
                </h3>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-travel-muted">
                  {storyDate(item) ? (
                    <time dateTime={text(item, "story_date") ?? undefined}>{storyDate(item)}</time>
                  ) : precision(item) ? (
                    <span>{precision(item)}</span>
                  ) : null}
                  {place(item.place) && <span>{place(item.place)}</span>}
                </div>
                <Gallery
                  items={media.filter((image) => image.update === item.id)}
                  fileUrl={fileUrl}
                  title={m.visitor_update_media()}
                  heading={false}
                  strip
                />
                <Markdown
                  className="max-w-travel-reading leading-relaxed"
                  html={text(item, "body_html")}
                  text={text(item, "body")}
                />
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The areas this audience was shown, in the order the story meets them, for the header. */
const HEADER_DESTINATIONS = 4;
function tripDestinations(projection: Projection): string[] {
  const labels = [
    ...new Set(
      [...projection.visits, ...projection.stays, ...projection.updates]
        .map((item) => {
          const area = item.place;
          return area && typeof area === "object" && !Array.isArray(area)
            ? text(area as ProjectionItem, "label")
            : null;
        })
        .filter((label): label is string => label !== null),
    ),
  ];
  return labels.length > HEADER_DESTINATIONS
    ? [
        ...labels.slice(0, HEADER_DESTINATIONS),
        m.visitor_more_destinations({ count: labels.length - HEADER_DESTINATIONS }),
      ]
    : labels;
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
  const [activeUpdate, setActiveUpdate] = useState<string | null>(null);
  // The map moves with the reader by default; a visitor who wants to look around on their own can turn that off.
  const [followStory, setFollowStory] = useState(true);
  const mapLines = useMemo(
    () =>
      projectionMapLines(projection).map((line) => {
        const route = projection.routes.find(
          (item) => item.id === line.id || `route-${item.id}` === line.id,
        );
        if (!route) return line;
        return {
          ...line,
          from: line.from ?? transportPlace(route.departure) ?? undefined,
          to: line.to ?? transportPlace(route.arrival) ?? undefined,
          dates:
            [
              transportTime(route, "departure") ??
                storyDate({ ...route, date_precision: "day" }, "departs_on"),
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
        const visit = projection.visits.find(
          (item) => item.id === point.id || `${item.id}-location` === point.id,
        );
        const placeItem = projection.places.find((item) => item.id === point.id);
        const route = projection.routes.find(
          (item) =>
            point.id === `transport-${item.id}-departure` ||
            point.id === `transport-${item.id}-arrival`,
        );
        const matchingPlace = (value: unknown) =>
          !!value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          (value as Record<string, unknown>).latitude === point.coordinates[1] &&
          (value as Record<string, unknown>).longitude === point.coordinates[0];
        const relatedVisits = projection.visits.filter(
          (item) =>
            item.id === visit?.id || matchingPlace(item.place) || matchingPlace(item.location),
        );
        const relatedUpdates = projection.updates.filter((item) => matchingPlace(item.place));
        const links = [
          ...(placeItem
            ? [{ label: m.visitor_view_location(), href: `#place-${placeItem.id}` }]
            : []),
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
  const displayed = new Set(
    navigableCollections.flatMap((key) => projection[key].map((item) => item.id)),
  );
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
  const looseMedia = projection.media.filter(
    (item) => typeof item.update !== "string" || !updateIds.has(item.update),
  );
  const empty = collections.every((key) => projection[key].length === 0);
  const dates = tripDates(projection.dates);
  // The cover is a photo the server already delivers to this audience; nothing here can fetch another.
  const coverItem =
    typeof projection.cover === "string"
      ? projection.media.find(
          (item) => item.id === projection.cover && hasFileMarker(item, "image"),
        )
      : undefined;
  const cover: TripCover | null = coverItem
    ? {
        url: fileUrl(coverItem),
        alt: text(coverItem, "alt_text") ?? "",
        caption: { html: text(coverItem, "caption_html"), text: text(coverItem, "caption") },
        focalX: focus(coverItem, "focal_x"),
        focalY: focus(coverItem, "focal_y"),
        width: positiveSize(coverItem, "width"),
        height: positiveSize(coverItem, "height"),
      }
    : null;
  const hasMap = mapLines.length > 0 || mapPoints.length > 0;
  // An update sits where its shared area sits on the map, found by the coordinates both already carry.
  const pointOf = (item: ProjectionItem) => {
    const area = item.place;
    if (!area || typeof area !== "object" || Array.isArray(area)) return undefined;
    const { latitude, longitude } = area as Record<string, unknown>;
    return mapPoints.find(
      (point) => point.coordinates[0] === longitude && point.coordinates[1] === latitude,
    );
  };
  // With the map and an update that has a place, the map sits beside the story and follows the reader down it.
  const mapBesideStory = hasMap && projection.updates.some((item) => pointOf(item));
  const followed = activeUpdate
    ? pointOf(projection.updates.find((item) => item.id === activeUpdate) ?? { id: "" })?.id
    : undefined;
  // One photo per place, from the first update there: only photos this audience already receives, at a place it
  // already sees.
  const mapPhotos: MapPhoto[] = [];
  for (const update of projection.updates) {
    const point = pointOf(update);
    if (!point || mapPhotos.some((photo) => photo.pointId === point.id)) continue;
    const photo = projection.media.find(
      (item) => item.update === update.id && hasFileMarker(item, "image") && fileUrl(item),
    );
    if (photo)
      mapPhotos.push({
        id: `${update.id}-${photo.id}`,
        pointId: point.id,
        coordinates: point.coordinates,
        url: fileUrl(photo)!,
        label: text(update, "title") ?? m.visitor_update(),
        onOpen: () => openUpdate(update.id),
      });
  }
  function openUpdate(id: string) {
    const target = document.getElementById(id);
    target?.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    target?.focus({ preventScroll: true });
  }
  const detailSections = [
    projection.visits,
    projection.places,
    projection.stays,
    projection.routes,
    projection.navigation.filter((item) => !displayed.has(item.id)),
  ].filter((items) => items.length > 0).length;
  const header = (
    <TripHeader
      title={projection.title ?? m.shared_trip()}
      eyebrow={previewResources ? m.assets_travel_preview() : "Travel"}
      level={previewResources ? "h2" : "h1"}
      dates={dates}
      destinations={tripDestinations(projection)}
      cover={cover}
    />
  );
  if (empty && !projection.summary && !dates)
    return (
      <div className={cn("grid gap-travel-grid-gap", previewResources ? "mt-5" : "mt-2")}>
        {header}
        <section className="travel-card" role="status">
          <h2>{m.visitor_no_content()}</h2>
          <p>{m.visitor_no_content_description()}</p>
        </section>
      </div>
    );

  const overview = projection.summary ? (
    <section className="travel-card" aria-label={m.visitor_overview()}>
      <h2>{m.visitor_overview()}</h2>
      <Markdown
        className="max-w-travel-reading leading-relaxed"
        html={projection.summary_html}
        text={projection.summary}
      />
    </section>
  ) : null;

  return (
    <div className={cn("grid gap-travel-grid-gap", previewResources ? "mt-5" : "mt-2")}>
      {header}
      {(projection.summary || hasMap) && !mapBesideStory && (
        <div
          className={cn(
            "grid min-w-0 gap-travel-grid-gap",
            projection.summary && hasMap && "travel-aside-split",
          )}
        >
          {overview}
          {hasMap && <TripMap wide points={mapPoints} lines={mapLines} />}
        </div>
      )}
      {empty && (
        <section className="travel-card" role="status">
          <h2>{m.visitor_no_story()}</h2>
          <p>{m.visitor_no_story_description()}</p>
        </section>
      )}
      {mapBesideStory ? (
        <div className="travel-story-map">
          {overview}
          <div data-story-map="">
            <TripMap
              wide
              points={mapPoints}
              lines={mapLines}
              follow={followStory ? followed : null}
              photos={mapPhotos}
            />
            <Field className="mt-2.5 hidden min-[1100px]:block">
              <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                <TravelCheckbox checked={followStory} onCheckedChange={setFollowStory} />
                <span>{m.visitor_map_follows_story()}</span>
              </FieldLabel>
            </Field>
          </div>
          <Updates
            updates={projection.updates}
            media={projection.media}
            fileUrl={fileUrl}
            besideMap
            onActive={setActiveUpdate}
          />
        </div>
      ) : (
        <Updates updates={projection.updates} media={projection.media} fileUrl={fileUrl} />
      )}
      {looseMedia.length > 0 && (
        <section className="travel-card" aria-label={m.visitor_gallery()}>
          <h2 className="mb-4.5">{m.visitor_gallery()}</h2>
          <Gallery
            items={looseMedia}
            fileUrl={fileUrl}
            title={m.visitor_shared_photos()}
            heading={false}
          />
        </section>
      )}
      <div
        className={cn(
          "grid min-w-0 items-start gap-travel-grid-gap",
          detailSections > 1 && "min-[1100px]:grid-cols-2",
        )}
      >
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
                <p>
                  {[text(item, "region"), text(item, "country_code")].filter(Boolean).join(" · ")}
                </p>
              )}
              {navigationLink(item)}
            </article>
          )}
        />
        <ResourceSection
          title={m.visitor_stays()}
          anchor="stay"
          items={projection.stays}
          render={(item) => (
            <article>
              <h3>{text(item, "title") ?? m.visitor_stay()}</h3>
              {tripDates(item) ? (
                <p>{tripDates(item)}</p>
              ) : (
                precision(item) && <p>{precision(item)}</p>
              )}
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
    </div>
  );
}
