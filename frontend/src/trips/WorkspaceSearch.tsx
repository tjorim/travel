import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";

import { AsyncSearchSelect, type SearchSelectOption } from "../forms/fields";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useTripResource, useTripsQuery } from "../query/owner-queries";
import { Field, FieldLabel } from "../ui/field";
import type { RecordKind } from "./record-focus";
import { matchesQuery, searchRecords, type SearchableRecords } from "./workspace-records";
import {
  locateRecord,
  sectionPath,
  WORKSPACE_SECTIONS,
  type TripWorkspaceSection,
} from "./workspace-sections";

/** Every place the search can jump to, as `tab` or `tab#block`, in the order the workspace shows them. */
function destinations(): SearchSelectOption[] {
  return WORKSPACE_SECTIONS.flatMap((section) => [
    { value: section.id as string, label: section.label() },
    ...(
      ("parts" in section ? section.parts : []) as readonly { id: string; label: () => string }[]
    ).map((part) => ({
      value: `${section.id}#${part.id}`,
      label: `${section.label()} › ${part.label()}`,
    })),
  ]);
}

const RECORD_PREFIX = "record:";

/** The trip's records, read from the owner cache the managers share; the search words never leave the browser. */
function useSearchableRecords(tripId: string): SearchableRecords {
  const areas = useTripResource(tripId, "areas").data;
  const locations = useTripResource(tripId, "locations").data;
  const visits = useTripResource(tripId, "visits").data;
  const stays = useTripResource(tripId, "stays").data;
  const routes = useTripResource(tripId, "routes").data;
  const tasks = useTripResource(tripId, "trip-tasks").data;
  const documents = useTripResource(tripId, "documents").data;
  const media = useTripResource(tripId, "media").data;
  const updates = useTripsQuery().data?.find((trip) => trip.id === tripId)?.travel_updates;
  return useMemo(
    () => ({ areas, locations, visits, stays, routes, tasks, documents, updates, media }),
    [areas, locations, visits, stays, routes, tasks, documents, updates, media],
  );
}

/**
 * Type to find a tab, a block inside one, or a record by its title, and go straight there: the block is expanded and
 * scrolled into view, and a record's dialog opens.
 */
export function WorkspaceSearch({ tripId }: { tripId: string }) {
  useLocale();
  const navigate = useNavigate();
  const records = useSearchableRecords(tripId);
  function jump(value: string) {
    if (!value) return;
    if (value.startsWith(RECORD_PREFIX)) {
      const [kind, id] = value.slice(RECORD_PREFIX.length).split(":") as [RecordKind, string];
      const place = locateRecord(kind);
      if (place)
        void navigate({
          to: sectionPath(tripId, place.section.id),
          state: { openRecord: { kind, id, token: Date.now() } },
        });
      return;
    }
    const [tab, part] = value.split("#") as [TripWorkspaceSection, string | undefined];
    void navigate({
      to: sectionPath(tripId, tab),
      hash: part,
      state: part ? { openSection: { id: part, token: Date.now() } } : undefined,
    });
  }
  const search = (query: string) =>
    Promise.resolve([
      ...destinations().filter((destination) => matchesQuery(String(destination.label), query)),
      ...searchRecords(records, query).map((match): SearchSelectOption =>
        match.type === "record"
          ? { value: `${RECORD_PREFIX}${match.kind}:${match.id}`, label: match.label }
          : { value: `more:${match.kind}`, label: match.label, isDisabled: true },
      ),
    ]);
  return (
    <Field className="flex items-center gap-2.5 max-[679px]:grid max-[679px]:gap-1 min-[680px]:max-w-md">
      <FieldLabel className="shrink-0 text-sm font-bold text-travel-muted">
        {m.owner_jump_to()}
      </FieldLabel>
      <div className="min-w-0 flex-1">
        <AsyncSearchSelect
          ariaLabel={m.owner_jump_to()}
          value=""
          defaultOptions={destinations()}
          loadOptions={search}
          debounceMs={0}
          onChange={jump}
        />
      </div>
    </Field>
  );
}
