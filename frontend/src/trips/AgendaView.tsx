import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { PlusIcon } from "lucide-react";
import { useMemo, useRef } from "react";

import {
  agendaRowAttribute,
  agendaRowId,
  stayOnDay,
  type CreateKind,
  type CreatePrefill,
} from "./create-request";

import { useTripResource } from "../query/owner-queries";
import { formatDayRange } from "../dates";
import { type Trip } from "../api-types";
import {
  buildAgendaItems,
  groupAgendaItems,
  type AgendaItem,
  type AgendaRecordKind,
} from "./agenda-items";

/**
 * One day's menu for starting a record there. The existing dialogs open with the day filled in, and with the area
 * where the owner is that day when a stay shows it (a new stay leaves the area to choose: it is usually elsewhere).
 */
function DayAddMenu({
  day,
  area,
  onCreate,
}: {
  day: string;
  area?: string;
  onCreate: (kind: CreateKind, prefill: CreatePrefill, returnTo: HTMLElement | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const start = (kind: CreateKind) =>
    onCreate(kind, kind === "stay" ? { day } : { day, areaId: area }, trigger.current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        className="secondary compact inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2.75 py-2 text-sm font-bold"
        aria-label={m.agenda_add_to_day({ day: formatDayRange(day, null) })}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
        {m.common_add()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => start("visit")}>
          {m.agenda_add_visit_on_day()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => start("stay")}>
          {m.agenda_add_stay_from_day()}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => start("route")}>
          {m.agenda_add_route_on_day()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Everything on the trip by day, in order, then what has no day yet: each row opens the record it
 * describes, since it is still edited in its own section. A day also starts new records.
 * Within a day, timed items come first; untimed items keep their record's own order (a route by
 * departure day/time/creation order, a visit by its day/time/creation order), not their opaque id.
 */
export function AgendaView({
  trip,
  onOpenRecord,
  onCreateRecord,
}: {
  trip: Trip;
  onOpenRecord?: (kind: AgendaRecordKind, id: string) => void;
  onCreateRecord?: (
    kind: CreateKind,
    prefill: CreatePrefill,
    returnTo?: HTMLElement | null,
  ) => void;
}) {
  const locale = useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");

  const items = useMemo(
    () => buildAgendaItems(staysQuery.data ?? [], routesQuery.data ?? [], visitsQuery.data ?? []),
    [locale, staysQuery.data, routesQuery.data, visitsQuery.data],
  );

  // Nothing disappears: what has no day yet is listed on its own.
  const { days, undated } = groupAgendaItems(items);

  const row = (item: AgendaItem) => (
    <li key={item.id}>
      <Button
        className="block w-full cursor-pointer border-0 bg-transparent px-0 py-1 text-left text-inherit disabled:cursor-default enabled:hover:underline enabled:focus-visible:underline"
        type="button"
        {...(item.phase === undefined || item.phase === "check-in"
          ? { [agendaRowAttribute]: agendaRowId(item.recordKind, item.recordId) }
          : {})}
        disabled={!onOpenRecord}
        onClick={() => onOpenRecord?.(item.recordKind, item.recordId)}
      >
        {item.time && <time>{item.time}</time>} <span>{item.text}</span>{" "}
        <small>
          {item.through && item.through !== item.first
            ? `${formatDayRange(item.first, item.through)} · `
            : ""}
          {item.where}
        </small>
      </Button>
    </li>
  );

  return (
    <section className="travel-card manager" aria-labelledby="agenda-title">
      <div className="capture-heading">
        <div>
          <h3 id="agenda-title">{m.agenda_agenda()}</h3>
          <p>{m.agenda_intro()}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p>{m.agenda_empty()}</p>
      ) : (
        <div className="saved-records mt-0.5">
          {days.map(([day, entries]) => (
            <article className="excerpt-row" data-stacked="" key={day}>
              <div className="flex items-center justify-between gap-2">
                <strong>{formatDayRange(day, null)}</strong>
                {onCreateRecord && (
                  <DayAddMenu
                    day={day}
                    area={stayOnDay(staysQuery.data ?? [], day)?.area.id}
                    onCreate={onCreateRecord}
                  />
                )}
              </div>
              <ul className="m-0 grid gap-1.5 pl-5">{entries.map(row)}</ul>
            </article>
          ))}
          {undated.length > 0 && (
            <article className="excerpt-row" data-stacked="">
              <strong>{m.common_no_day_yet()}</strong>
              <ul className="m-0 grid gap-1.5 pl-5">{undated.map(row)}</ul>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
