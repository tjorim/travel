import { m } from "../paraglide/messages.js";
import {
  ownerLocationName,
  routeTitle,
  stayLabel,
  visitTitle,
  type Area,
  type DocumentAsset,
  type Location,
  type MediaAsset,
  type Route,
  type Stay,
  type TravelUpdate,
  type TripTask,
  type Visit,
  areaName,
} from "../tracker-model";
import type { RecordKind } from "./record-focus";
import { locateRecord } from "./workspace-sections";

/** The owner-only records of one trip that the jump search can find; a list that has not loaded yet is absent. */
export type SearchableRecords = {
  areas?: Area[];
  locations?: Location[];
  visits?: Visit[];
  stays?: Stay[];
  routes?: Route[];
  tasks?: TripTask[];
  documents?: DocumentAsset[];
  updates?: TravelUpdate[];
  media?: MediaAsset[];
};

/** How many matches one kind of record shows; the rest is counted, so a trip with many photos cannot bury the others. */
export const RECORDS_PER_KIND = 5;

type Candidate = { kind: RecordKind; id: string; title: string };

/** In the order the workspace shows them. */
function candidates(records: SearchableRecords): Candidate[] {
  const list = <T extends { id: string }>(
    kind: RecordKind,
    items: T[] | undefined,
    title: (item: T) => string,
  ): Candidate[] => (items ?? []).map((item) => ({ kind, id: item.id, title: title(item) }));
  return [
    ...list("area", records.areas, (area) => areaName(area)),
    ...list("location", records.locations, ownerLocationName),
    ...list("visit", records.visits, visitTitle),
    ...list("stay", records.stays, stayLabel),
    ...list("route", records.routes, routeTitle),
    ...list("task", records.tasks, (task) => task.title),
    ...list("document", records.documents, (document) => document.title),
    ...list("update", records.updates, (update) => update.title),
    ...list(
      "media",
      records.media,
      (asset) => asset.original_filename ?? m.owner_unnamed_media_item(),
    ),
  ];
}

/** Lower case without accents, so "cafe" finds "Café". */
export const normalizeSearchText = (text: string) =>
  text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Every word of the query appears in the text. */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = normalizeSearchText(text);
  return normalizeSearchText(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export type RecordMatch =
  /** `label` reads "Plan › Stays › Hotel Taipei". */
  | { type: "record"; kind: RecordKind; id: string; label: string }
  /** Says how many more matches of a kind were left out; it cannot be chosen. */
  | { type: "more"; kind: RecordKind; label: string };

/** The records whose title matches, labelled with their tab and block. Pure and local: the query never leaves the browser. */
export function searchRecords(records: SearchableRecords, query: string): RecordMatch[] {
  const found = candidates(records).filter((candidate) => matchesQuery(candidate.title, query));
  const result: RecordMatch[] = [];
  for (const kind of new Set(found.map((candidate) => candidate.kind))) {
    const place = locateRecord(kind);
    if (!place) continue;
    const ofKind = found.filter((candidate) => candidate.kind === kind);
    const prefix = `${place.section.label()} › ${place.part.label()}`;
    for (const candidate of ofKind.slice(0, RECORDS_PER_KIND))
      result.push({
        type: "record",
        kind,
        id: candidate.id,
        label: `${prefix} › ${candidate.title}`,
      });
    if (ofKind.length > RECORDS_PER_KIND)
      result.push({
        type: "more",
        kind,
        label: m.owner_jump_more_matches({
          p0: ofKind.length - RECORDS_PER_KIND,
          p1: prefix,
        }),
      });
  }
  return result;
}
