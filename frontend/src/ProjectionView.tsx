import { VisitorNumbers } from "./VisitorNumbers";
import type {
  DateRange,
  Projection,
  ProjectionArea,
  ProjectionItem,
  ProjectionMedia,
  ProjectionRoute,
  ProjectionStay,
  ProjectionUpdate,
  ProjectionVisit,
} from "./projection-types";
import { Spinner } from "@/ui/spinner";
import { Alert } from "@/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { m } from "./paraglide/messages.js";
import { selectedLocale, useLocale } from "./locale";
import { Collapsible } from "@/ui/collapsible";
import { Dialog } from "@/ui/dialog";
import { Button } from "@/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon, XIcon } from "lucide-react";
import { Field, FieldLabel } from "@/ui/field";
import { Switch } from "@/ui/switch";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "cn";
import { dayjs } from "./dayjs";
import { Markdown } from "./Markdown";
import { TripMap, type MapLine, type MapPhoto, type MapPoint } from "./TripMap";
import { TripHeader, type TripCover } from "./TripHeader";
import { groupStoryContext, type UpdateContext } from "./visitor-context";
import { localDay, planByDay, type DayEntry, type PlanDay, type PlanRecords } from "./visitor-days";
import { ROUTE_MODE_LABELS, timeForViewer, zoneName, type RouteMode } from "./tracker-model";

const CurrentLocations = lazy(() => import("./CurrentLocations"));

export type {
  Projection,
  ProjectionArea,
  ProjectionDates,
  ProjectionItem,
  ProjectionMedia,
  ProjectionPlace,
  ProjectionRoute,
  ProjectionStay,
  ProjectionUpdate,
  ProjectionVisit,
} from "./projection-types";

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

type View = "story" | "map" | "plan";

const sideBySideQuery = "(min-width: 1100px)";

/** True once the viewport is wide enough for the story and map to sit side by side. */
function useSideBySide() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia?.(sideBySideQuery);
      query?.addEventListener?.("change", notify);
      return () => query?.removeEventListener?.("change", notify);
    },
    () => window.matchMedia?.(sideBySideQuery).matches ?? false,
    () => false,
  );
}

/**
 * A tab panel below 1100 px. Side by side every panel shows at once and the tab list is gone, so the
 * panels drop their tab semantics (and inert/hidden state) rather than claim a tablist that is absent.
 */
function ViewPanel({
  sideBySide,
  ...props
}: ComponentProps<typeof TabsContent> & { sideBySide: boolean }) {
  return (
    <TabsContent
      keepMounted
      {...(sideBySide
        ? {
            role: "presentation",
            hidden: false,
            inert: false,
            tabIndex: undefined,
            "aria-labelledby": undefined,
          }
        : {})}
      {...props}
    />
  );
}

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

/** A delivered string, or null when it is missing or empty. */
function text(value: string | null | undefined): string | null {
  return value || null;
}

/** A country's name in the selected language; the delivered code when the runtime cannot name it. */
function country(item: { country_code?: string | null }): string | null {
  const code = text(item.country_code);
  if (!code) return null;
  try {
    return new Intl.DisplayNames([selectedLocale()], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function place(area: ProjectionArea | null | undefined): string | null {
  if (!area) return null;
  return [text(area.label), text(area.region), country(area)].filter(Boolean).join(" · ") || null;
}

function precision(item: { date_precision?: string | null }): string | null {
  const value = text(item.date_precision);
  return value === "day"
    ? m.visitor_day_precision()
    : value === "month"
      ? m.visitor_month_precision()
      : value === "year"
        ? m.visitor_year_precision()
        : null;
}

function transportPlace(area: ProjectionArea | null | undefined): string | null {
  if (!area) return null;
  const names = [text(area.label), text(area.region)];
  return names.some(Boolean)
    ? [...names, country(area)].filter(Boolean).join(" · ")
    : country(area);
}

function transportTime(item: ProjectionRoute, endpoint: "departure" | "arrival"): string | null {
  const value = text(endpoint === "departure" ? item.departs_at : item.arrives_at);
  if (!value || !dayjs(value).isValid()) return null;
  const timeZone = text(endpoint === "departure" ? item.departure_timezone : item.arrival_timezone);
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

/**
 * A date delivered as a day, a month or a year, written in the selected language; null for an impossible date or one
 * that disagrees with its own precision. Without a precision, the length of the date says it.
 */
function storyDate(
  delivered: string | null | undefined,
  precisionOf: string | null | undefined,
): string | null {
  const value = text(delivered);
  const precisionValue =
    text(precisionOf) ??
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
export function tripDates(dates: DateRange | null | undefined): string | null {
  if (!dates) return null;
  const [start, end] = [
    storyDate(dates.starts_on, dates.date_precision),
    storyDate(dates.ends_on, dates.date_precision),
  ];
  return start && end && start !== end ? `${start} – ${end}` : (start ?? end);
}

/** A shared visit time: local at the visit, with the viewer's own time when that differs. */
export function visitTimes(item: ProjectionVisit): string | null {
  const start = text(item.start_time);
  if (!start) return null;
  const end = text(item.end_time);
  const zone = text(item.timezone);
  const date = text(item.starts_on);
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

function positiveSize(item: ProjectionMedia, field: "width" | "height"): number | undefined {
  const value = item[field];
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 4000
    ? value
    : undefined;
}

function focus(item: ProjectionMedia, field: "focal_x" | "focal_y"): number {
  const value = item[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : 50;
}

/** True when the record carries the projection-local file marker of this kind, and it is its own. */
function hasFileMarker(item: ProjectionMedia, field: "image" | "video"): boolean {
  return item[field]?.id === item.id;
}

function ResourceSection<T extends ProjectionItem>({
  title,
  items,
  render,
  anchor,
}: {
  title: string;
  items: T[];
  render: (item: T) => ReactNode;
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

function routeHeading(item: ProjectionRoute): string {
  return (
    text(item.label) ??
    ([text(item.carrier), text(item.service_reference)].filter(Boolean).join(" · ") ||
      transportKinds()[text(item.mode) ?? ""] ||
      m.visitor_route())
  );
}

function RouteSummary({ item }: { item: ProjectionRoute }) {
  useLocale();
  const departure = transportPlace(item.departure);
  const arrival = transportPlace(item.arrival);
  const departsAt = transportTime(item, "departure");
  const arrivesAt = transportTime(item, "arrival");
  // A route with a day (or only its month or year, as far as the audience may read) but no times.
  const departsOn = storyDate(item.departs_on, item.date_precision);
  const mode = transportKinds()[text(item.mode) ?? ""];
  const carrier = [text(item.carrier), text(item.service_reference)].filter(Boolean).join(" · ");
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
          text(item.status) ? (transportStatuses()[item.status] ?? item.status) : null,
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

function VisitCard({ item }: { item: ProjectionVisit }) {
  useLocale();
  return (
    <article>
      <h3>{text(item.title) ?? m.visitor_visit()}</h3>
      {tripDates(item) && <p>{tripDates(item)}</p>}
      {visitTimes(item) && <p>{visitTimes(item)}</p>}
      <Markdown under={3} html={text(item.summary_html)} text={text(item.summary)} />
      {place(item.place) && <p>{place(item.place)}</p>}
    </article>
  );
}

function StayCard({
  item,
  navigationLink,
}: {
  item: ProjectionStay;
  navigationLink: (item: ProjectionItem) => ReactNode;
}) {
  useLocale();
  return (
    <article>
      <h3>{text(item.title) ?? m.visitor_stay()}</h3>
      {tripDates(item) ? <p>{tripDates(item)}</p> : precision(item) && <p>{precision(item)}</p>}
      {place(item.place) && <p>{place(item.place)}</p>}
      {navigationLink(item)}
    </article>
  );
}

/** A local clock time for a delivered instant, or nothing when it is missing or unreadable. */
function clock(value: string | null, timeZone: string | null): string | null {
  if (!value || !dayjs(value).isValid()) return null;
  try {
    return dayjs(value)
      .tz(timeZone ?? undefined)
      .format("HH:mm");
  } catch {
    return dayjs(value).format("HH:mm");
  }
}

/** A calendar day as the selected locale writes it; the year only when the plan spans more than one. */
function dayText(date: string, withYear: boolean, format = "D MMM") {
  const day = dayjs.utc(date).locale(selectedLocale());
  return withYear ? `${day.format(format)} ${day.format("YYYY")}` : day.format(format);
}

function RouteEntry({
  item,
  date,
  withYear,
}: {
  item: ProjectionRoute;
  date: string;
  withYear: boolean;
}) {
  const departure = transportPlace(item.departure);
  const arrival = transportPlace(item.arrival);
  const mode = transportKinds()[text(item.mode) ?? ""];
  const carrier = [text(item.carrier), text(item.service_reference)].filter(Boolean).join(" · ");
  const status = transportStatuses()[text(item.status) ?? ""];
  const departsAt = clock(text(item.departs_at), text(item.departure_timezone));
  const arrivesAt = clock(text(item.arrives_at), text(item.arrival_timezone));
  // A route is listed once, on the day it leaves. A later arrival day is only said, never listed again.
  const arrivalDay = item.arrives_at
    ? localDay(item.arrives_at, text(item.arrival_timezone))
    : null;
  const later = arrivalDay && arrivalDay !== date ? arrivalDay : null;
  return (
    <>
      <span className="block font-bold">{routeHeading(item)}</span>
      <span className="block text-travel-muted">
        {[m.visitor_route(), mode, carrier || null, status].filter(Boolean).join(" · ")}
      </span>
      {(departure || arrival) && (
        <span className="block">
          {departure ?? m.visitor_departure_unknown()} → {arrival ?? m.visitor_arrival_unknown()}
        </span>
      )}
      {(departsAt || arrivesAt) && (
        <span className="block">
          {departsAt ?? m.visitor_departure_time_unknown()} →{" "}
          {arrivesAt ?? m.visitor_arrival_time_unknown()}
          {later && ` (${m.visitor_route_arrives({ date: dayText(later, withYear) })})`}
        </span>
      )}
    </>
  );
}

function DayEntryRow({
  entry,
  date,
  withYear,
  navigationLink,
}: {
  entry: DayEntry;
  date: string;
  withYear: boolean;
  navigationLink: (item: ProjectionItem) => ReactNode;
}) {
  const { item } = entry;
  // The anchors the map and the update context link to; a stay's later days carry none.
  const anchor =
    entry.type === "visit"
      ? `visit-${item.id}`
      : entry.type === "route"
        ? `route-${item.id}`
        : entry.phase === "check-in"
          ? `stay-${item.id}`
          : undefined;
  const area = entry.type === "stay" ? (text(entry.item.title) ?? m.visitor_stay()) : "";
  return (
    <li
      id={anchor}
      tabIndex={anchor ? -1 : undefined}
      data-day-entry={entry.type === "stay" ? `stay-${entry.phase}` : entry.type}
      className="min-w-0 scroll-mt-6 wrap-anywhere focus:outline-none [&_a]:font-bold [&_a]:text-travel-forest [&_a]:underline-offset-3 [&_p]:my-1 [&_p]:whitespace-pre-wrap"
    >
      {entry.type === "visit" && (
        <>
          <span className="block font-bold">{text(entry.item.title) ?? m.visitor_visit()}</span>
          <span className="block text-travel-muted">
            {[m.visitor_visit(), place(entry.item.place)].filter(Boolean).join(" · ")}
          </span>
          {entry.until && (
            <span className="block">
              {m.visitor_visit_until({ date: dayText(entry.until, withYear) })}
            </span>
          )}
          {visitTimes(entry.item) && <span className="block">{visitTimes(entry.item)}</span>}
          <Markdown
            under={3}
            html={text(entry.item.summary_html)}
            text={text(entry.item.summary)}
          />
        </>
      )}
      {entry.type === "route" && <RouteEntry item={entry.item} date={date} withYear={withYear} />}
      {entry.type === "stay" && entry.phase === "check-in" && (
        <>
          <span className="block font-bold">{m.visitor_day_stay({ place: area })}</span>
          {place(entry.item.place) && (
            <span className="block text-travel-muted">{place(entry.item.place)}</span>
          )}
          {navigationLink(entry.item)}
        </>
      )}
      {entry.type === "stay" && entry.phase === "night" && (
        <span className="block text-travel-muted">{m.agenda_sleeping_in({ place: area })}</span>
      )}
      {entry.type === "stay" && entry.phase === "check-out" && (
        <span className="block">{m.agenda_check_out({ place: area })}</span>
      )}
    </li>
  );
}

/** Shared visits, stays and routes on the days the document delivers, with a stay shown across its nights. */
function DayPlan({
  days,
  navigationLink,
}: {
  days: PlanDay[];
  navigationLink: (item: ProjectionItem) => ReactNode;
}) {
  useLocale();
  const withYear = new Set(days.map((day) => day.date.slice(0, 4))).size > 1;
  return (
    <section className="travel-card" aria-label={m.visitor_by_day()} data-day-plan="">
      <h2 className="mb-4.5">{m.visitor_by_day()}</h2>
      <ol className="m-0 grid list-none p-0">
        {days.map((day) => (
          <li
            key={day.date}
            data-day={day.date}
            className="flex flex-col gap-x-4 gap-y-1.5 border-t border-travel-divider py-3 first:border-0 first:pt-0 last:pb-0 min-[30rem]:flex-row"
          >
            <h3 className="m-0 shrink-0 text-base leading-tight font-bold min-[30rem]:w-22">
              <time
                dateTime={day.date}
                className="flex flex-wrap items-baseline gap-x-1.5 min-[30rem]:grid"
              >
                <span className="text-xs font-bold tracking-travel-eyebrow text-travel-muted uppercase">
                  {dayText(day.date, false, "ddd")}
                </span>{" "}
                <span>{dayText(day.date, withYear)}</span>
              </time>
            </h3>
            <ul className="m-0 grid min-w-0 flex-1 list-none gap-2.5 p-0 text-sm">
              {day.entries.map((entry) => (
                <DayEntryRow
                  key={entry.key}
                  entry={entry}
                  date={day.date}
                  withYear={withYear}
                  navigationLink={navigationLink}
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What has no day of its own: kept with its own precision, never placed on a day or put in an order. */
function OtherPlans({
  plan,
  navigationLink,
}: {
  plan: PlanRecords;
  navigationLink: (item: ProjectionItem) => ReactNode;
}) {
  useLocale();
  const rows = [
    ...plan.visits.map((item) => ({
      item,
      anchor: "visit",
      kind: m.visitor_visit(),
      body: <VisitCard item={item} />,
    })),
    ...plan.stays.map((item) => ({
      item,
      anchor: "stay",
      kind: m.visitor_stay(),
      body: <StayCard item={item} navigationLink={navigationLink} />,
    })),
    ...plan.routes.map((item) => ({
      item,
      anchor: "route",
      kind: m.visitor_route(),
      body: <RouteSummary item={item} />,
    })),
  ];
  if (!rows.length) return null;
  return (
    <section className="travel-card" aria-label={m.visitor_other_plans()} data-other-plans="">
      <h2 className="mb-1.5">{m.visitor_other_plans()}</h2>
      <p className="mt-0 mb-4.5 text-sm text-travel-muted">{m.visitor_other_plans_hint()}</p>
      <ul className="m-0 grid list-none gap-0 p-0 [&_a]:mt-2.5 [&_a]:inline-block [&_a]:font-bold [&_a]:text-travel-forest [&_a]:underline-offset-3 [&_a:focus-visible]:outline-3 [&_a:focus-visible]:outline-offset-3 [&_a:focus-visible]:outline-travel-focus [&_h3]:mb-1.75 [&_h3]:text-lg [&_p]:my-1.25 [&_p]:wrap-anywhere [&_p]:whitespace-pre-wrap">
        {rows.map(({ item, anchor, kind, body }) => (
          <li
            className="border-t border-travel-divider py-4 first:border-0 first:pt-0 last:pb-0"
            key={`${anchor}-${item.id}`}
            id={`${anchor}-${item.id}`}
          >
            <p className="mb-1 text-xs font-bold tracking-travel-eyebrow text-travel-muted uppercase">
              {kind}
            </p>
            {body}
          </li>
        ))}
      </ul>
    </section>
  );
}

const transportMode = (value: string | null | undefined): RouteMode =>
  value && value in ROUTE_MODE_LABELS ? (value as RouteMode) : "other";

/** A delivered point as [longitude, latitude], only when both are real coordinates. */
const validPoint = (values: {
  latitude?: number | null;
  longitude?: number | null;
}): [number, number] | null => {
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
    if (text(item.status) === "cancelled") return [];
    const transport = transportMode(text(item.mode));
    const line = item.geometry;
    if (
      line &&
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
    const end = (endpoint: "departure" | "arrival") => {
      const location = routeLocationPoint(item, endpoint);
      if (location) return { coordinates: location.coordinates, label: location.label };
      const area = item[endpoint];
      if (!area) return null;
      const coordinates = validPoint(area);
      return coordinates ? { coordinates, label: text(area.label) ?? "" } : null;
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
  const point = (id: string, area: ProjectionArea | null | undefined): MapPoint[] => {
    const coordinates = area ? validPoint(area) : null;
    return area && coordinates
      ? [{ id, label: area.label ?? m.visitor_location(), coordinates }]
      : [];
  };
  const points = [
    ...projection.places.flatMap((item) => point(item.id, item)),
    ...projection.visits.flatMap((item) => [
      ...point(item.id, item.place),
      ...point(`${item.id}-location`, item.location),
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
  item: ProjectionRoute,
  endpoint: "departure" | "arrival",
): MapPoint | null {
  const point = item.map?.[endpoint];
  const coordinates = point ? validPoint(point) : null;
  if (!point || !coordinates) return null;
  return {
    id: `transport-${item.id}-${endpoint}`,
    label:
      point.label ||
      (endpoint === "departure" ? m.visitor_departure_point() : m.visitor_arrival_point()),
    coordinates,
    kind: point.kind === "airport" ? "airport" : "place",
  };
}

/** Whole days between two updates dated to the day, else null: the story's "3 days later" connector. */
function daysLater(previous: ProjectionUpdate | undefined, item: ProjectionUpdate): number | null {
  const [from, to] = [previous, item].map((entry) => {
    // `storyDate` rejects an impossible date and a month or year date, so only a valid day gets a gap.
    const value =
      entry && storyDate(entry.story_date, entry.date_precision) ? text(entry.story_date) : null;
    return value?.length === 10 ? dayjs.utc(value) : null;
  });
  if (!from?.isValid() || !to?.isValid()) return null;
  const days = to.diff(from, "day");
  return days > 0 ? days : null;
}

/** The alt text of a shared photo, with a translated fallback. */
function photoAlt(item: ProjectionMedia) {
  return text(item.alt_text) ?? m.visitor_shared_image();
}

/** One shared photo as a button that opens the gallery's lightbox on it; a failed load offers a retry. */
function SharedImage({
  item,
  url,
  onOpen,
  triggerRef,
  fill = false,
  hint,
}: {
  item: ProjectionMedia;
  url: string;
  onOpen: () => void;
  triggerRef: (element: HTMLButtonElement | null) => void;
  /** A mosaic tile fills the box its parent gives it and crops to it, around the photo's focal point. */
  fill?: boolean;
  hint?: string;
}) {
  useLocale();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alt = photoAlt(item);
  const open = m.visitor_open_image({ title: alt });
  const button = (
    <Button
      ref={triggerRef}
      type="button"
      className={cn(
        "block w-full cursor-pointer rounded-travel-media border-0 bg-transparent p-0 text-travel-ink transition duration-150 hover:brightness-105 motion-reduce:transition-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus",
        fill &&
          "relative min-h-0 flex-1 overflow-hidden bg-travel-tint text-sm focus-visible:-outline-offset-3",
      )}
      aria-label={failed ? `${m.visitor_image_failed()} ${open}` : open}
      onClick={onOpen}
    >
      <img
        key={`${url}:${attempt}`}
        className={cn(
          "block bg-travel-tint object-cover",
          fill
            ? "absolute inset-0 size-full"
            : "aspect-4/3 h-auto w-full rounded-travel-media shadow-travel-card",
        )}
        src={url}
        alt={alt}
        width={positiveSize(item, "width")}
        height={positiveSize(item, "height")}
        style={{ objectPosition: `${focus(item, "focal_x")}% ${focus(item, "focal_y")}%` }}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        hidden={failed}
      />
      {failed && m.visitor_image_failed()}
    </Button>
  );
  const status = failed && (
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
  if (!fill)
    return (
      <>
        {button}
        {status}
      </>
    );
  return (
    <div className="flex size-full min-h-0 flex-col">
      {button}
      {status}
      {hint && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-travel-hero-scrim/80 px-2.5 py-1 text-xs font-bold text-travel-hero-ink"
        >
          <ImagesIcon aria-hidden="true" className="size-3.5" />
          {hint}
        </span>
      )}
    </div>
  );
}

/** The enlarged photo of the lightbox, its caption over the bottom; a failed load offers a retry for this photo only. */
function LightboxImage({ item, url }: { item: ProjectionMedia; url: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <figure className="pointer-events-none absolute inset-0 m-0 grid grid-cols-1 grid-rows-1 place-items-center">
      <img
        key={`${url}:${attempt}`}
        className="max-h-full max-w-full object-contain select-none"
        src={url}
        alt={photoAlt(item)}
        width={positiveSize(item, "width")}
        height={positiveSize(item, "height")}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        hidden={failed}
        draggable={false}
      />
      {failed && (
        <div role="status" className="pointer-events-auto grid justify-items-center gap-3">
          <p className="m-0">{m.visitor_image_failed()}</p>
          <Button
            type="button"
            className="border border-white/40 bg-transparent text-travel-lightbox-ink focus-visible:outline-travel-lightbox-focus"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            {m.retry()}
          </Button>
        </div>
      )}
      <Markdown
        as="figcaption"
        className="pointer-events-auto absolute inset-x-0 bottom-0 max-h-2/5 overflow-y-auto bg-linear-to-t from-travel-lightbox/90 via-travel-lightbox/75 to-transparent px-5 pt-12 pb-travel-safe-bottom text-center leading-normal text-travel-lightbox-ink min-[680px]:px-travel-lightbox-caption"
        html={text(item.caption_html)}
        text={text(item.caption)}
      />
    </figure>
  );
}

type Photo = { item: ProjectionMedia; url: string };

/** Fewer pixels than this, or a mostly vertical drag, is a scroll or a tap rather than a swipe. */
const SWIPE_DISTANCE = 48;

/**
 * One dark, full-bleed dialog for all the photos of a gallery: previous and next buttons, the arrow keys and a
 * horizontal swipe move through them, a label gives the position, the caption sits over the bottom of the photo,
 * and closing returns focus to the photo's own button. Only the neighbouring approved derivatives are preloaded.
 * The interface language is not switched here: a photo's delivered alt text and caption have no translation to
 * switch to, and the language choice stays in the page's preferences.
 */
function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
  returnFocus,
}: {
  photos: Photo[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  returnFocus: (index: number) => HTMLElement | boolean;
}) {
  useLocale();
  // The dialog keeps showing the last photo while it fades out.
  const last = useRef(0);
  if (index !== null) last.current = index;
  const current = Math.min(last.current, photos.length - 1);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const before = index === null ? undefined : photos[index - 1]?.url;
  const after = index === null ? undefined : photos[index + 1]?.url;
  useEffect(() => {
    // Only the neighbouring approved derivatives are fetched ahead, never an original.
    for (const url of [before, after]) {
      if (!url) continue;
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.src = url;
    }
  }, [before, after]);
  const photo = photos[current];
  if (!photo) return null;
  const go = (step: -1 | 1) => {
    const next = current + step;
    if (next >= 0 && next < photos.length) onIndex(next);
  };
  const control =
    "pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full border border-white/30 bg-travel-lightbox/70 p-0 text-travel-lightbox-ink backdrop-blur-sm hover:bg-travel-lightbox data-disabled:opacity-30 focus-visible:outline-travel-lightbox-focus";
  return (
    <Dialog.Root open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-travel-lightbox travel-backdrop-motion" />
        <Dialog.Viewport className="fixed inset-0 z-50">
          <Dialog.Popup
            className="relative size-full overflow-hidden bg-travel-lightbox text-travel-lightbox-ink travel-backdrop-motion"
            finalFocus={() => returnFocus(current)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (event.key === "ArrowLeft") go(-1);
              else if (event.key === "ArrowRight") go(1);
              else return;
              event.preventDefault();
            }}
          >
            <Dialog.Title className="sr-only">{photoAlt(photo.item)}</Dialog.Title>
            <div
              className="absolute inset-0 touch-pan-y"
              onPointerDown={(event) => {
                swipe.current =
                  event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY };
              }}
              onPointerCancel={() => (swipe.current = null)}
              onPointerUp={(event) => {
                const start = swipe.current;
                swipe.current = null;
                if (!start) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5)
                  go(dx < 0 ? 1 : -1);
              }}
            >
              <LightboxImage key={photo.item.id} item={photo.item} url={photo.url} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-linear-to-b from-travel-lightbox/85 to-transparent px-4 pt-travel-safe-top pb-6">
              {photos.length > 1 ? (
                <p
                  className="m-0 rounded-full bg-travel-lightbox/70 px-3 py-1.5 text-sm font-bold"
                  role="status"
                >
                  {m.visitor_photo_position({ current: current + 1, total: photos.length })}
                </p>
              ) : (
                <span />
              )}
              <Dialog.Close className={control} aria-label={m.visitor_close_image()}>
                <XIcon aria-hidden="true" className="size-5" />
              </Dialog.Close>
            </div>
            {photos.length > 1 && (
              <nav
                className="pointer-events-none absolute inset-x-3 top-1/2 z-10 flex -translate-y-1/2 justify-between"
                aria-label={m.visitor_photo_navigation()}
              >
                <Button
                  type="button"
                  className={control}
                  focusableWhenDisabled
                  disabled={current === 0}
                  aria-label={m.visitor_previous_photo()}
                  onClick={() => go(-1)}
                >
                  <ChevronLeftIcon aria-hidden="true" className="size-5" />
                </Button>
                <Button
                  type="button"
                  className={control}
                  focusableWhenDisabled
                  disabled={current === photos.length - 1}
                  aria-label={m.visitor_next_photo()}
                  onClick={() => go(1)}
                >
                  <ChevronRightIcon aria-hidden="true" className="size-5" />
                </Button>
              </nav>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One shared video with controls and a poster, fetched only when played. */
function SharedVideo({
  item,
  url,
  poster,
}: {
  item: ProjectionMedia;
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
        aria-label={text(item.alt_text) ?? m.visitor_shared_video()}
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

/** Rows of the smaller tiles under a mosaic's lead photo: three to a row, never one alone, so each row fills the width. */
function tileRows(count: number): number[] {
  const rows: number[] = Array(Math.floor(count / 3)).fill(3);
  const rest = count % 3;
  if (rest === 2) rows.push(2);
  else if (rest === 1) {
    if (rows.length) {
      rows.pop();
      rows.push(2, 2);
    } else rows.push(1);
  }
  return rows;
}
/** The span of a tile in a six-column row, by how many tiles share its row. */
const TILE_SPAN: Record<number, string> = { 1: "col-span-6", 2: "col-span-3", 3: "col-span-2" };

/**
 * The photos and videos of a story, as a grid. With `lead` an update's photos are arranged to be seen at a glance:
 * one photo wide; two side by side with the first larger; three or more as a large first photo over a mosaic of
 * the rest, with the count shown. A video always keeps its own full-width frame under the photos.
 */
function Gallery({
  items,
  fileUrl,
  title = m.visitor_gallery(),
  heading = true,
  lead = false,
}: {
  items: ProjectionMedia[];
  fileUrl: (item: ProjectionItem) => string | null;
  title?: string;
  /** A gallery already under a heading of its own is named for assistive technology only. */
  heading?: boolean;
  /** Lead with the photos: one wide frame, or a mosaic with a larger first photo. */
  lead?: boolean;
}) {
  useLocale();
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [open, setOpen] = useState<number | null>(null);
  const photos = items.flatMap((item) => {
    const url = hasFileMarker(item, "image") ? fileUrl(item) : null;
    return url ? [{ item, url }] : [];
  });
  if (!items.length) return null;
  const images = items.filter((item) => hasFileMarker(item, "image"));
  const mosaic = lead && images.length >= 2;
  const rest = mosaic ? items.filter((item) => !images.includes(item)) : items;
  const trigger = (item: ProjectionMedia) => (element: HTMLButtonElement | null) => {
    if (element) triggers.current.set(item.id, element);
    else triggers.current.delete(item.id);
  };
  const tile = (item: ProjectionMedia, hint?: string) =>
    fileUrl(item) ? (
      <SharedImage
        fill
        hint={hint}
        item={item}
        url={fileUrl(item)!}
        onOpen={() => setOpen(photos.findIndex((photo) => photo.item.id === item.id))}
        triggerRef={trigger(item)}
      />
    ) : (
      <p
        className="m-0 flex size-full items-center justify-center gap-2 bg-travel-tint"
        role="status"
      >
        <Spinner />
        {m.visitor_image_loading()}
      </p>
    );
  const count = m.visitor_photo_count({ count: images.length });
  const rows = mosaic
    ? tileRows(images.length - 1).flatMap((size) => Array<number>(size).fill(size))
    : [];
  return (
    <section className={cn("min-w-0", heading && "mt-6")} aria-label={title}>
      {heading && <h4 className="mb-3 text-base">{title}</h4>}
      {mosaic && (
        <ul
          data-mosaic=""
          className={cn(
            "m-0 grid list-none gap-1.5 p-0",
            images.length === 2
              ? "h-travel-mosaic-pair grid-cols-travel-mosaic-pair min-[680px]:h-travel-mosaic-pair-wide"
              : "grid-cols-6",
          )}
        >
          {images.map((item, position) => (
            <li
              key={item.id}
              className={cn(
                "relative min-h-0 min-w-0 overflow-hidden rounded-travel-media shadow-travel-card",
                images.length > 2 &&
                  (position === 0
                    ? "col-span-6 aspect-4/3 min-[680px]:aspect-3/2"
                    : cn(
                        TILE_SPAN[rows[position - 1]!],
                        "min-h-travel-mosaic-row min-[680px]:min-h-travel-mosaic-row-wide",
                      )),
              )}
            >
              {tile(item, position === 0 ? count : undefined)}
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul
          className={cn(
            "m-0 grid list-none gap-3.5 p-0",
            mosaic && "mt-3.5",
            lead
              ? "grid-cols-1"
              : "grid-cols-1 min-[560px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1500px]:grid-cols-4",
          )}
        >
          {rest.map((item) => (
            <li className={cn("min-w-0", lead && "max-w-170")} key={item.id}>
              <figure className="m-0">
                {hasFileMarker(item, "image") &&
                  (fileUrl(item) ? (
                    <SharedImage
                      item={item}
                      url={fileUrl(item)!}
                      onOpen={() => setOpen(photos.findIndex((photo) => photo.item.id === item.id))}
                      triggerRef={trigger(item)}
                    />
                  ) : (
                    <p className="flex items-center gap-2" role="status">
                      <Spinner />
                      {m.visitor_image_loading()}
                    </p>
                  ))}
                {hasFileMarker(item, "video") && fileUrl(item) && (
                  <SharedVideo
                    item={item}
                    url={fileUrl(item)!}
                    poster={fileUrl({ id: `${item.id}-poster` }) ?? undefined}
                  />
                )}
                {hasFileMarker(item, "video") && !fileUrl(item) && (
                  <p className="flex items-center gap-2" role="status">
                    <Spinner />
                    {m.visitor_video_loading()}
                  </p>
                )}
                <Markdown
                  as="figcaption"
                  className="mt-1.75 wrap-anywhere leading-normal text-travel-muted"
                  html={text(item.caption_html)}
                  text={text(item.caption)}
                />
              </figure>
            </li>
          ))}
        </ul>
      )}
      <PhotoLightbox
        photos={photos}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        returnFocus={(position) => {
          const element = triggers.current.get(photos[position]?.item.id ?? "");
          return element ?? true;
        }}
      />
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

/** Compact approved visits, stays and routes of the same area and day, shown with the update they belong to. */
function UpdateContextBlock({
  context,
  navigationLink,
}: {
  context: UpdateContext;
  navigationLink?: (item: ProjectionItem) => ReactNode;
}) {
  useLocale();
  const entries = [
    ...context.stays.map((item) => ({
      item,
      anchor: "stay",
      kind: m.visitor_stay(),
      title: text(item.title) ?? m.visitor_stay(),
      lines: [tripDates(item)],
    })),
    ...context.visits.map((item) => ({
      item,
      anchor: "visit",
      kind: m.visitor_visit(),
      title: text(item.title) ?? m.visitor_visit(),
      lines: [tripDates(item), visitTimes(item)],
    })),
    ...context.routes.map((item) => {
      const departure = transportPlace(item.departure);
      const arrival = transportPlace(item.arrival);
      const mode = transportKinds()[text(item.mode) ?? ""];
      const status = transportStatuses()[text(item.status) ?? ""];
      return {
        item,
        anchor: "route",
        kind: m.visitor_route(),
        title: routeHeading(item),
        lines: [
          departure || arrival
            ? `${departure ?? m.visitor_departure_unknown()} → ${arrival ?? m.visitor_arrival_unknown()}`
            : null,
          [mode, status].filter(Boolean).join(" · ") || null,
          [transportTime(item, "departure"), transportTime(item, "arrival")].some(Boolean)
            ? `${transportTime(item, "departure") ?? m.visitor_departure_time_unknown()} → ${transportTime(item, "arrival") ?? m.visitor_arrival_time_unknown()}`
            : storyDate(item.departs_on, item.date_precision),
        ],
      };
    }),
  ];
  if (!entries.length) return null;
  return (
    <section
      data-update-context=""
      aria-label={m.visitor_update_context()}
      className="rounded-travel-media border border-travel-divider bg-travel-tint px-3.5 py-3 text-sm"
    >
      <p className="m-0 mb-2 text-xs font-bold tracking-travel-eyebrow text-travel-muted uppercase">
        {m.visitor_update_context()}
      </p>
      <ul className="m-0 grid list-none gap-2.5 p-0">
        {entries.map(({ item, anchor, kind, title, lines }) => (
          <li
            key={`${anchor}-${item.id}`}
            id={`${anchor}-${item.id}`}
            tabIndex={-1}
            className="min-w-0 scroll-mt-6 wrap-anywhere focus:outline-none [&_a]:font-bold [&_a]:text-travel-forest [&_a]:underline-offset-3"
          >
            <span className="font-bold">{kind}: </span>
            <span>{title}</span>
            {lines
              .filter((line): line is string => !!line)
              .map((line) => (
                <span key={line} className="block text-travel-muted">
                  {line}
                </span>
              ))}
            {anchor === "stay" && <span className="block">{navigationLink?.(item)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The dated story: an index, then each update with its place, photos and text. */
function Updates({
  updates,
  media,
  fileUrl,
  besideMap = false,
  onActive,
  context,
  navigationLink,
}: {
  updates: ProjectionUpdate[];
  media: ProjectionMedia[];
  /** Approved visits, stays and routes tied to exactly one update by their shared area and day. */
  context?: Map<string, UpdateContext>;
  navigationLink?: (item: ProjectionItem) => ReactNode;
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
    <section
      id="story"
      tabIndex={-1}
      className="travel-card scroll-mt-4 focus:outline-none"
      aria-label={m.visitor_updates()}
    >
      <h2 className="sr-only">{m.visitor_updates()}</h2>
      <div className={besideMap ? "grid gap-3" : "travel-story-split"}>
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
                      {text(item.title) ??
                        storyDate(item.story_date, item.date_precision) ??
                        m.visitor_update()}
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
                    {text(item.title) ??
                      storyDate(item.story_date, item.date_precision) ??
                      m.visitor_update()}
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
                  {text(item.title) ?? m.visitor_update()}
                </h3>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-travel-muted">
                  {storyDate(item.story_date, item.date_precision) ? (
                    <time dateTime={text(item.story_date) ?? undefined}>
                      {storyDate(item.story_date, item.date_precision)}
                    </time>
                  ) : precision(item) ? (
                    <span>{precision(item)}</span>
                  ) : null}
                  {place(item.place) && <span>{place(item.place)}</span>}
                </div>
                <Gallery
                  items={media.filter((image) => image.update === item.id)}
                  fileUrl={fileUrl}
                  title={m.visitor_update_media_named({
                    number: index + 1,
                    title: text(item.title) ?? m.visitor_update(),
                  })}
                  heading={false}
                  lead
                />
                <Markdown
                  under={3}
                  className="max-w-travel-reading leading-relaxed"
                  html={text(item.body_html)}
                  text={text(item.body)}
                />
                {context?.get(item.id) && (
                  <UpdateContextBlock
                    context={context.get(item.id)!}
                    navigationLink={navigationLink}
                  />
                )}
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
        .map((item) => text(item.place?.label))
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
  apiBase,
  previewResources,
  focusId,
}: {
  projection: Projection;
  audience: Audience;
  identifier: string;
  /** Where this document's files and navigation live when that is not `/api/{public/trips|shared}/{identifier}`. */
  apiBase?: string;
  previewResources?: PreviewResources;
  /** An update of this document to bring into view and focus on first show, as the owner's preview does. */
  focusId?: string;
}) {
  const locale = useLocale();
  const deliveryBase =
    apiBase ??
    `${audience === "public" ? "/api/public/trips" : "/api/shared"}/${encodeURIComponent(identifier)}`;
  const sideBySide = useSideBySide();
  const [view, setView] = useState<View>("story");
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
                storyDate(route.departs_on, route.date_precision),
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
        const matchingPlace = (value: ProjectionArea | null | undefined) =>
          !!value &&
          value.latitude === point.coordinates[1] &&
          value.longitude === point.coordinates[0];
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
            label: m.visitor_visit_link({ title: text(item.title) ?? m.visitor_visit() }),
            href: `#visit-${item.id}`,
          })),
          ...relatedUpdates.map((item) => ({
            label: m.visitor_update_link({ title: text(item.title) ?? m.visitor_update() }),
            href: `#${item.id}`,
          })),
          ...(route ? [{ label: m.visitor_view_route(), href: `#route-${route.id}` }] : []),
        ];
        return { ...point, dates: visit ? (tripDates(visit) ?? undefined) : undefined, links };
      }),
    [projection, locale],
  );
  const story = useMemo(() => groupStoryContext(projection), [projection]);
  useEffect(() => {
    if (previewResources) return;
    const revealFragment = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;
      const target = document.getElementById(fragment);
      // Records grouped under an update live in the story, so their anchors reveal it, not the plan.
      const inStory =
        projection.updates.some((item) => fragment === item.id) ||
        target?.closest("[data-update-context]") != null;
      if (!target) return;
      setView(inStory ? "story" : "plan");
      requestAnimationFrame(() => {
        target.scrollIntoView?.();
        target.focus({ preventScroll: true });
      });
    };
    revealFragment();
    window.addEventListener("hashchange", revealFragment);
    return () => window.removeEventListener("hashchange", revealFragment);
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
    return (
      <a
        href={`${deliveryBase}/navigation/${encodeURIComponent(item.id)}`}
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
      : `${deliveryBase}/files/${encodeURIComponent(item.id)}`;
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
        alt: text(coverItem.alt_text) ?? "",
        caption: { html: text(coverItem.caption_html), text: text(coverItem.caption) },
        focalX: focus(coverItem, "focal_x"),
        focalY: focus(coverItem, "focal_y"),
        width: positiveSize(coverItem, "width"),
        height: positiveSize(coverItem, "height"),
      }
    : null;
  const hasMap = mapLines.length > 0 || mapPoints.length > 0;
  // An update sits where its shared area sits on the map, found by the coordinates both already carry.
  const pointOf = (item: ProjectionUpdate) => {
    const area = item.place;
    if (!area) return undefined;
    const { latitude, longitude } = area;
    return mapPoints.find(
      (point) => point.coordinates[0] === longitude && point.coordinates[1] === latitude,
    );
  };
  // With the map and an update that has a place, the map sits beside the story and follows the reader down it.
  const mapBesideStory = hasMap && projection.updates.some((item) => pointOf(item));
  const followedUpdate = activeUpdate
    ? projection.updates.find((item) => item.id === activeUpdate)
    : undefined;
  const followed = followedUpdate ? pointOf(followedUpdate)?.id : undefined;
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
        label: text(update.title) ?? m.visitor_update(),
        onOpen: () => openUpdate(update.id),
      });
  }
  /** Brings an update into view and focuses it, as following its index link would. */
  function openUpdate(id: string) {
    setView("story");
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.scrollIntoView?.({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
      target?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (focusId && projection.updates.some((item) => item.id === focusId)) openUpdate(focusId);
    // Only a different requested update re-aims the view, not each rendering of the same one.
  }, [focusId, projection]);
  // Days come only from what the document delivers; records already shown with a story update are not repeated.
  const plan = planByDay(story.separate, projection);
  const timeline = plan.days.length > 0;
  const looseNavigation = projection.navigation.filter((item) => !displayed.has(item.id));
  const otherPlans = plan.other.visits.length + plan.other.stays.length + plan.other.routes.length;
  const detailSections = timeline
    ? [plan.days, otherPlans ? [otherPlans] : [], projection.places, looseNavigation].filter(
        (items) => items.length > 0,
      ).length
    : [
        plan.other.visits,
        projection.places,
        plan.other.stays,
        plan.other.routes,
        looseNavigation,
      ].filter((items) => items.length > 0).length;
  const header = (
    <>
      <TripHeader
        title={projection.title ?? m.shared_trip()}
        eyebrow={previewResources ? m.assets_travel_preview() : "Travel"}
        level={previewResources ? "h2" : "h1"}
        dates={dates}
        destinations={tripDestinations(projection)}
        cover={cover}
      />
      <VisitorNumbers numbers={projection.numbers} />
      {!!projection.current_locations?.length && (
        <Suspense fallback={null}>
          <CurrentLocations positions={projection.current_locations} />
        </Suspense>
      )}
    </>
  );
  if (empty && !projection.summary && !dates)
    return (
      <div className={cn("grid gap-travel-grid-gap", previewResources ? "mt-5" : "mt-2")}>
        {header}
        <Alert className="travel-card" role="status">
          <h2>{m.visitor_no_content()}</h2>
          <p>{m.visitor_no_content_description()}</p>
        </Alert>
      </div>
    );

  const overview = projection.summary ? (
    <section className="travel-card" aria-label={m.visitor_overview()}>
      <h2>{m.visitor_overview()}</h2>
      <Markdown
        under={2}
        className="max-w-travel-reading leading-relaxed"
        html={projection.summary_html}
        text={projection.summary}
      />
    </section>
  ) : null;

  const areasSection = (
    <ResourceSection
      title={m.visitor_places()}
      anchor="place"
      items={projection.places}
      render={(item) => (
        <article>
          <h3>{text(item.label) ?? m.visitor_location()}</h3>
          {[text(item.region), country(item)].filter(Boolean).length > 0 && (
            <p>{[text(item.region), country(item)].filter(Boolean).join(" · ")}</p>
          )}
          {navigationLink(item)}
        </article>
      )}
    />
  );
  const navigationSection = looseNavigation.length > 0 && (
    <ResourceSection
      title={m.visitor_navigation()}
      anchor="navigation"
      items={looseNavigation}
      render={(item) => (
        <article>
          <h3>{m.visitor_destination()}</h3>
          {navigationLink(item)}
        </article>
      )}
    />
  );
  const areasAndNavigation = (
    <>
      {areasSection}
      {navigationSection}
    </>
  );

  return (
    <Tabs
      value={view}
      onValueChange={(next) => setView(next as View)}
      className={cn("grid gap-travel-grid-gap", previewResources ? "mt-5" : "mt-2")}
    >
      {header}
      <div className="min-[1100px]:hidden">
        <TabsList aria-label={m.visitor_view()} activateOnFocus>
          <TabsTrigger value="story">{m.visitor_story()}</TabsTrigger>
          {hasMap && <TabsTrigger value="map">{m.visitor_map()}</TabsTrigger>}
          {detailSections > 0 && <TabsTrigger value="plan">{m.visitor_plan()}</TabsTrigger>}
        </TabsList>
      </div>
      <div className={hasMap ? "travel-story-map" : "grid min-w-0"}>
        <ViewPanel value="story" sideBySide={sideBySide} className="grid gap-travel-grid-gap">
          <Updates
            updates={projection.updates}
            media={projection.media}
            fileUrl={fileUrl}
            besideMap
            onActive={setActiveUpdate}
            context={story.byUpdate}
            navigationLink={navigationLink}
          />
          {projection.updates.length === 0 && (
            <section className="travel-card">
              <h2>{m.visitor_no_story()}</h2>
              <p>{m.visitor_no_story_description()}</p>
            </section>
          )}
          {overview}
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
        </ViewPanel>
        {hasMap && (
          <ViewPanel value="map" sideBySide={sideBySide} data-story-map="">
            {mapBesideStory && (
              <Field className="mb-2.5 hidden min-[1100px]:block">
                <FieldLabel className="flex items-center gap-2 text-sm font-semibold">
                  <Switch checked={followStory} onCheckedChange={setFollowStory} />
                  <span>{m.visitor_map_follows_story()}</span>
                </FieldLabel>
              </Field>
            )}
            <TripMap
              wide
              bare
              headingLevel={2}
              points={mapPoints}
              lines={mapLines}
              follow={followStory ? followed : null}
              photos={mapPhotos}
            />
          </ViewPanel>
        )}
      </div>
      <ViewPanel value="plan" sideBySide={sideBySide} className="grid gap-travel-grid-gap">
        {plan.daysNotShared && (
          <p
            className="m-0 rounded-travel-media border border-travel-divider bg-travel-tint px-3.5 py-3 text-sm"
            data-days-not-shown=""
          >
            {m.visitor_days_not_shown()}
          </p>
        )}
        <div
          className={cn(
            "grid min-w-0 items-start gap-travel-grid-gap",
            detailSections > 1 &&
              (timeline ? "min-[1100px]:grid-cols-5" : "min-[1100px]:grid-cols-2"),
          )}
        >
          {timeline && (
            <div className={cn("min-w-0", detailSections > 1 && "min-[1100px]:col-span-3")}>
              <DayPlan days={plan.days} navigationLink={navigationLink} />
            </div>
          )}
          {timeline ? (
            detailSections > 1 && (
              <div className="grid min-w-0 gap-travel-grid-gap min-[1100px]:col-span-2">
                <OtherPlans plan={plan.other} navigationLink={navigationLink} />
                {areasAndNavigation}
              </div>
            )
          ) : (
            <>
              <ResourceSection
                title={m.visitor_visits()}
                anchor="visit"
                items={plan.other.visits}
                render={(item) => <VisitCard item={item} />}
              />
              {areasSection}
              <ResourceSection
                title={m.visitor_stays()}
                anchor="stay"
                items={plan.other.stays}
                render={(item) => <StayCard item={item} navigationLink={navigationLink} />}
              />
              <ResourceSection
                title={m.visitor_routes()}
                anchor="route"
                items={plan.other.routes}
                render={(item) => <RouteSummary item={item} />}
              />
              {navigationSection}
            </>
          )}
        </div>
      </ViewPanel>
    </Tabs>
  );
}
