import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EllipsisVerticalIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import {
  agendaRowAttribute,
  agendaRowId,
  stayOnDay,
  type CreateKind,
  type CreatePrefill,
} from "../records/create-request";

import { errorMessage } from "@/lib/api/api";
import { useTripResource } from "@/lib/query/owner-queries";
import { formatDayRange, daysBetween } from "@/lib/dates";
import { type Stay, type Trip, type Visit } from "@/api-types";
import {
  AGENDA_KINDS,
  AGENDA_STATUSES,
  NO_FILTER,
  isFiltered,
  useAgendaFilter,
} from "./agenda-filter";
import {
  buildAgendaItems,
  filterAgenda,
  groupAgendaItems,
  isRecordRow,
  withTripDays,
  type AgendaItem,
  type AgendaRecordKind,
  type AgendaStatusGroup,
} from "./agenda-items";
import { stayLabel } from "@/lib/records";
import { PLANNING_STATUS_LABELS } from "@/lib/labels";
import { canAdjustNights } from "../stays/model";
import { Overnight } from "../visits/Overnight";
import { visibilityLabel } from "../records/visibility";
import { RestatedRoutesNote } from "../records/VisitRouteHint";
import type { DialogFocusAction } from "@/hooks/useRecordDialog";

/**
 * What a row can do besides opening its record. A row has a menu only when the agenda is given these; the delete
 * and edit requests open the record's dialog on that step, so the confirmation and the calls stay in the editors.
 */
export type AgendaRowActions = {
  onAct: (
    kind: AgendaRecordKind,
    id: string,
    action: DialogFocusAction,
    returnTo: HTMLElement | null,
  ) => void;
  onShowOnMap?: (visit: Visit) => void;
  /** Whether a visit has a copy saved on this device. */
  isPinned: (visit: Visit) => boolean;
  onToggleOffline: (visit: Visit) => void;
  /** Moves a stay's check-out by a night; offered on a stay that `canAdjustNights`. */
  onAdjustNights: (stay: Stay, delta: -1 | 1) => void;
  adjustingNights: boolean;
};

const STATUS_LABELS: Record<AgendaStatusGroup, () => string> = {
  plan: () => m.agenda_status_plan(),
  idea: () => m.agenda_status_idea(),
  cancelled: () => m.trips_cancelled(),
};
const KIND_LABELS: Record<AgendaRecordKind, () => string> = {
  visit: () => m.common_visits(),
  stay: () => m.common_stays(),
  route: () => m.common_routes(),
};

const menuTrigger =
  "secondary compact inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2.75 py-2 text-sm font-bold";

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
        className={menuTrigger}
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

/** The block's own menu for starting a record that needs no day: an idea, an undated visit, the first stay. */
function NewMenu({
  onCreate,
}: {
  onCreate: (kind: CreateKind, prefill: CreatePrefill, returnTo: HTMLElement | null) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const start = (kind: CreateKind) => onCreate(kind, {}, trigger.current);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger ref={trigger} className={menuTrigger}>
        <PlusIcon className="size-4" aria-hidden="true" />
        {m.agenda_new()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => start("visit")}>{m.visits_new_visit()}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => start("stay")}>{m.stays_new_stay()}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => start("route")}>{m.routes_new_route()}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A row's menu: Edit, Show on map and Save offline (visits), Delete. Each choice first puts focus on the menu's
 * own button, so the dialog it opens gives focus back to this row, or to its neighbour once the record is gone.
 */
function RowMenu({ item, actions }: { item: AgendaItem; actions: AgendaRowActions }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const { record } = item;
  const visit = record.kind === "visit" ? record.value : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={trigger}
        className={`${menuTrigger} min-w-11 justify-center px-2`}
        aria-label={m.agenda_row_actions({ title: item.title })}
      >
        <EllipsisVerticalIcon className="size-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => actions.onAct(item.recordKind, item.recordId, "edit", trigger.current)}
        >
          {m.common_edit()}
        </DropdownMenuItem>
        {visit && actions.onShowOnMap && (
          <DropdownMenuItem onClick={() => actions.onShowOnMap?.(visit)}>
            {m.visits_show_on_map_action()}
          </DropdownMenuItem>
        )}
        {visit && (
          <DropdownMenuItem onClick={() => actions.onToggleOffline(visit)}>
            {actions.isPinned(visit) ? m.common_remove_offline_copy() : m.common_save_offline()}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="text-travel-danger"
          onClick={() => actions.onAct(item.recordKind, item.recordId, "delete", trigger.current)}
        >
          {m.common_delete()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The one-night-less and one-night-more buttons of a stay still being planned, under the same rule as before. */
function NightsControl({
  stay,
  actions,
}: {
  stay: Stay;
  actions: Pick<AgendaRowActions, "onAdjustNights" | "adjustingNights">;
}) {
  const nights = daysBetween(stay.check_in_date, stay.check_out_date);
  const name = stayLabel(stay);
  return (
    <div
      className="button-row items-center"
      role="group"
      aria-label={m.stays_stay_nights_group({ name })}
    >
      <Button
        className="secondary compact min-h-11 min-w-11"
        type="button"
        disabled={actions.adjustingNights || nights <= 1}
        aria-label={m.stays_stay_one_night_less({ name })}
        onClick={() => actions.onAdjustNights(stay, -1)}
      >
        −
      </Button>
      <span aria-hidden="true" className="min-w-16 text-center text-sm font-bold">
        {m.common_night_count({ count: nights })}
      </span>
      <Button
        className="secondary compact min-h-11 min-w-11"
        type="button"
        disabled={actions.adjustingNights}
        aria-label={m.stays_stay_one_night_more({ name })}
        onClick={() => actions.onAdjustNights(stay, 1)}
      >
        +
      </Button>
    </div>
  );
}

/** What differs from the common case, as words: an idea or a cancelled record, and who it is shared with. */
function setApart(item: AgendaItem): string[] {
  return [
    item.status === "idea" || item.status === "cancelled"
      ? PLANNING_STATUS_LABELS[item.status]
      : "",
    item.visibility === "private" ? "" : visibilityLabel(item.visibility),
  ].filter(Boolean);
}

/**
 * Everything on the trip by day, in order, then what has no day yet. Each row opens its record's dialog and carries
 * a menu of what to do with it; a day also starts new records. Within a day, timed items come first; untimed items
 * keep their record's own order (a route by departure day/time/creation order, a visit by its day/time/creation
 * order), not their opaque id. Two filters narrow the list by kind and by status, per trip, in this browser.
 */
export function AgendaView({
  trip,
  onOpenRecord,
  onCreateRecord,
  actions,
  notice,
  alternatives,
  kindRequest,
}: {
  trip: Trip;
  onOpenRecord?: (kind: AgendaRecordKind, id: string) => void;
  onCreateRecord?: (
    kind: CreateKind,
    prefill: CreatePrefill,
    returnTo?: HTMLElement | null,
  ) => void;
  actions?: AgendaRowActions;
  /** The block's status line: what the last save, delete or row action reported. */
  notice?: string | null;
  /** The alternatives of every kind, shown above the timeline. */
  alternatives?: ReactNode;
  /**
   * Asks for the kinds an address names (`#stays`): they replace the filter, every status included, as the block
   * the address used to open listed all of them. Each request has its own token, so asking twice applies twice.
   */
  kindRequest?: { kinds: readonly AgendaRecordKind[]; token: number } | null;
}) {
  const locale = useLocale();
  const staysQuery = useTripResource(trip.id, "stays");
  const routesQuery = useTripResource(trip.id, "routes");
  const visitsQuery = useTripResource(trip.id, "visits");
  const { filter, setFilter } = useAgendaFilter(trip.id);
  const requestToken = kindRequest?.token;
  useEffect(() => {
    if (kindRequest) setFilter({ kinds: [...kindRequest.kinds], statuses: [] });
  }, [requestToken]);

  const items = useMemo(
    () => buildAgendaItems(staysQuery.data ?? [], routesQuery.data ?? [], visitsQuery.data ?? []),
    [locale, staysQuery.data, routesQuery.data, visitsQuery.data],
  );

  const filtered = isFiltered(filter);
  const shown = useMemo(() => filterAgenda(items, filter), [items, filter]);
  // Nothing disappears: what has no day yet is listed on its own. A day with nothing planned shows too, until a
  // filter asks for something in particular.
  const grouped = groupAgendaItems(shown);
  const days = filtered ? grouped.days : withTripDays(grouped.days, trip);
  const undated = grouped.undated;
  const recordCount = (rows: readonly AgendaItem[]) => rows.filter(isRecordRow).length;

  const readError = staysQuery.error ?? routesQuery.error ?? visitsQuery.error;
  const status = readError
    ? errorMessage(readError, m.agenda_could_not_be_loaded)
    : (notice ?? null);

  // Starting a record from here shows it afterwards: a filter that would hide it is dropped first.
  const create = onCreateRecord
    ? (kind: CreateKind, prefill: CreatePrefill, returnTo: HTMLElement | null) => {
        if (filtered) setFilter(NO_FILTER);
        onCreateRecord(kind, prefill, returnTo);
      }
    : undefined;

  const row = (item: AgendaItem) => {
    const own = isRecordRow(item);
    const apart = own ? setApart(item) : [];
    const visit = item.record.kind === "visit" ? item.record.value : null;
    const stay = item.record.kind === "stay" ? item.record.value : null;
    return (
      <li key={item.id} className="grid gap-1">
        <div className="flex items-start gap-1">
          <Button
            className="block min-w-0 flex-1 cursor-pointer border-0 bg-transparent px-0 py-1 text-left text-inherit disabled:cursor-default enabled:hover:underline enabled:focus-visible:underline"
            type="button"
            {...(own ? { [agendaRowAttribute]: agendaRowId(item.recordKind, item.recordId) } : {})}
            disabled={!onOpenRecord}
            onClick={() => onOpenRecord?.(item.recordKind, item.recordId)}
          >
            {item.time && <time>{item.time}</time>}{" "}
            <span className="font-semibold">{item.text}</span>{" "}
            <small className="text-travel-muted">
              {[
                item.through && item.through !== item.first
                  ? formatDayRange(item.first, item.through)
                  : "",
                item.where,
                ...apart,
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
          </Button>
          {actions && own && <RowMenu item={item} actions={actions} />}
        </div>
        {actions && own && stay && item.phase === "check-in" && canAdjustNights(stay) && (
          <NightsControl stay={stay} actions={actions} />
        )}
        {visit && own && (
          <>
            <Overnight visit={visit} stays={staysQuery.data ?? []} trip={trip} />
            <RestatedRoutesNote routes={visit.possible_route_duplicates ?? []} />
          </>
        )}
      </li>
    );
  };

  return (
    <section className="travel-card manager" aria-labelledby="agenda-title">
      <div className="capture-heading">
        <div>
          <h3 id="agenda-title">{m.agenda_agenda()}</h3>
          <p>{m.agenda_intro()}</p>
        </div>
        {create && <NewMenu onCreate={create} />}
      </div>
      <div className="grid gap-2">
        <ToggleGroup
          multiple
          aria-label={m.agenda_filter_kind()}
          value={filter.kinds}
          onValueChange={(kinds) =>
            setFilter({
              ...filter,
              kinds: AGENDA_KINDS.filter((kind) => kinds.includes(kind)),
            })
          }
        >
          {AGENDA_KINDS.map((kind) => (
            <ToggleGroupItem key={kind} value={kind}>
              {KIND_LABELS[kind]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          multiple
          aria-label={m.agenda_filter_status()}
          value={filter.statuses}
          onValueChange={(statuses) =>
            setFilter({
              ...filter,
              statuses: AGENDA_STATUSES.filter((group) => statuses.includes(group)),
            })
          }
        >
          {AGENDA_STATUSES.map((group) => (
            <ToggleGroupItem key={group} value={group}>
              {STATUS_LABELS[group]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {filtered && (
          <p className="help m-0 flex flex-wrap items-center gap-2">
            {m.agenda_filter_summary({
              shown: recordCount(shown),
              total: recordCount(items),
            })}
            <Button
              className="secondary compact"
              type="button"
              onClick={() => setFilter(NO_FILTER)}
            >
              {m.agenda_filter_clear()}
            </Button>
          </p>
        )}
      </div>
      <p className="help empty:hidden" role="status">
        {status}
      </p>
      {alternatives}
      {days.length === 0 && items.length === 0 ? (
        <p>{m.agenda_empty()}</p>
      ) : days.length === 0 && shown.length === 0 ? (
        <p>{m.agenda_filter_no_match()}</p>
      ) : (
        <div className="saved-records mt-0.5">
          {days.map(([day, entries]) => (
            <article className="excerpt-row" data-stacked="" key={day}>
              <div className="flex items-center justify-between gap-2">
                <strong>{formatDayRange(day, null)}</strong>
                {entries.length === 0 && (
                  <span className="min-w-0 flex-1 text-sm text-travel-muted max-[479px]:sr-only">
                    {m.agenda_nothing_planned()}
                  </span>
                )}
                {create && (
                  <DayAddMenu
                    day={day}
                    area={stayOnDay(staysQuery.data ?? [], day)?.area.id}
                    onCreate={create}
                  />
                )}
              </div>
              {entries.length > 0 && (
                <ul className="m-0 grid list-none gap-1.5 p-0">{entries.map(row)}</ul>
              )}
            </article>
          ))}
          {undated.length > 0 && (
            <article className="excerpt-row" data-stacked="">
              <strong>{m.common_no_day_yet()}</strong>
              <ul className="m-0 grid list-none gap-1.5 p-0">{undated.map(row)}</ul>
            </article>
          )}
        </div>
      )}
    </section>
  );
}
