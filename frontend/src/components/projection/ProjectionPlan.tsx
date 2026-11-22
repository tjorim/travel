import type {
  Projection,
  ProjectionItem,
  ProjectionRoute,
  ProjectionStay,
  ProjectionVisit,
} from "@/api-types";
import { LocalName } from "@/components/LocalName";
import { Markdown } from "@/components/Markdown";
import { selectedLocale, useLocale } from "@/i18n/locale";
import { dayjs } from "@/lib/dayjs";
import { m } from "@/paraglide/messages.js";
import { cn } from "cn";
import type { ReactNode } from "react";
import { PlaceText } from "./PlaceText";
import {
  country,
  place,
  precision,
  routeHeading,
  storyDate,
  text,
  transportKinds,
  transportPlace,
  transportStatuses,
  transportTime,
  tripDates,
  visitTimes,
} from "./projectionFormatting";
import { localDay, planByDay, type DayEntry, type PlanDay, type PlanRecords } from "./visitor-days";
import { Authored, useTextLang } from "./visitor-language";

const navigableCollections = ["places", "stays"] as const;

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

/** A route's name where the owner wrote one, else what it is: carrier, service or kind of transport. */
function RouteHeading({
  item,
  as,
  className,
}: {
  item: ProjectionRoute;
  as: "h3" | "span";
  className?: string;
}) {
  return (
    <Authored
      as={as}
      className={className}
      of={text(item.label)}
      marker={item.label_lang}
      fallback={routeHeading(item)}
    />
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
      <RouteHeading item={item} as="h3" />
      {(departure || arrival) && (
        <p>
          {item.departure && departure ? (
            <PlaceText area={item.departure} transport />
          ) : (
            m.visitor_departure_unknown()
          )}{" "}
          →{" "}
          {item.arrival && arrival ? (
            <PlaceText area={item.arrival} transport />
          ) : (
            m.visitor_arrival_unknown()
          )}
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
  const lang = useTextLang();
  return (
    <article>
      <Authored
        as="h3"
        of={text(item.title)}
        marker={item.title_lang}
        fallback={m.visitor_visit()}
      />
      {tripDates(item) && <p>{tripDates(item)}</p>}
      {visitTimes(item) && <p>{visitTimes(item)}</p>}
      <Markdown
        under={3}
        lang={lang(item.summary_lang)}
        html={text(item.summary_html)}
        text={text(item.summary)}
      />
      {item.place && place(item.place) && (
        <p>
          <PlaceText area={item.place} />
        </p>
      )}
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
      <Authored
        as="h3"
        of={text(item.title)}
        marker={item.title_lang}
        fallback={m.visitor_stay()}
      />
      {tripDates(item) ? <p>{tripDates(item)}</p> : precision(item) && <p>{precision(item)}</p>}
      {item.place && place(item.place) && (
        <p>
          <PlaceText area={item.place} />
        </p>
      )}
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
      <RouteHeading item={item} as="span" className="block font-bold" />
      <span className="block text-travel-muted">
        {[m.visitor_route(), mode, carrier || null, status].filter(Boolean).join(" · ")}
      </span>
      {(departure || arrival) && (
        <span className="block">
          {item.departure && departure ? (
            <PlaceText area={item.departure} transport />
          ) : (
            m.visitor_departure_unknown()
          )}{" "}
          →{" "}
          {item.arrival && arrival ? (
            <PlaceText area={item.arrival} transport />
          ) : (
            m.visitor_arrival_unknown()
          )}
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
  const lang = useTextLang();
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
          <Authored
            as="span"
            className="block font-bold"
            of={text(entry.item.title)}
            marker={entry.item.title_lang}
            fallback={m.visitor_visit()}
          />
          <span className="block text-travel-muted">
            {m.visitor_visit()}
            {entry.item.place && place(entry.item.place) && (
              <>
                {" · "}
                <PlaceText area={entry.item.place} />
              </>
            )}
          </span>
          {entry.until && (
            <span className="block">
              {m.visitor_visit_until({ date: dayText(entry.until, withYear) })}
            </span>
          )}
          {visitTimes(entry.item) && <span className="block">{visitTimes(entry.item)}</span>}
          <Markdown
            under={3}
            lang={lang(entry.item.summary_lang)}
            html={text(entry.item.summary_html)}
            text={text(entry.item.summary)}
          />
        </>
      )}
      {entry.type === "route" && <RouteEntry item={entry.item} date={date} withYear={withYear} />}
      {entry.type === "stay" && entry.phase === "check-in" && (
        <>
          <span className="block font-bold">{m.visitor_day_stay({ place: area })}</span>
          {entry.item.place && place(entry.item.place) && (
            <span className="block text-travel-muted">
              <PlaceText area={entry.item.place} />
            </span>
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

export function projectionPlan(projection: Projection, separate: PlanRecords) {
  const displayed = new Set(
    navigableCollections.flatMap((key) => projection[key].map((item) => item.id)),
  );
  // Days come only from what the document delivers; records already shown with a story update are not repeated.
  const plan = planByDay(separate, projection);
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
  return { plan, timeline, looseNavigation, detailSections };
}

export function ProjectionPlan({
  projection,
  details: { plan, timeline, looseNavigation, detailSections },
  navigationLink,
}: {
  projection: Projection;
  details: ReturnType<typeof projectionPlan>;
  navigationLink: (item: ProjectionItem) => ReactNode;
}) {
  const areasSection = (
    <ResourceSection
      title={m.visitor_places()}
      anchor="place"
      items={projection.places}
      render={(item) => (
        <article>
          <Authored
            as="h3"
            of={text(item.label)}
            marker={item.label_lang}
            fallback={m.visitor_location()}
          />
          {text(item.label) && text(item.local_name) && (
            <p>
              <LocalName name={text(item.local_name) ?? ""} className="text-inherit" />
            </p>
          )}
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
    <>
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
    </>
  );
}
