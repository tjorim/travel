import { areaName } from "../tracker-model";
import type { Area, Location } from "../tracker-model";

export type DuplicateReason = "name" | "coordinates" | "address";
/** Records that look like the same place, in list order; the first is the suggested one to keep. */
export type DuplicateGroup = { ids: string[]; reasons: DuplicateReason[] };

/** Case, accents, punctuation and spacing do not make two names different. */
const normalize = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const rounded = (latitude: number | null, longitude: number | null, digits: number) =>
  latitude == null || longitude == null
    ? ""
    : `${latitude.toFixed(digits)},${longitude.toFixed(digits)}`;

/**
 * Groups records that share a key by any rule; a record in two rules joins both groups into one.
 * Nothing is merged: the owner decides what to do with a suggestion.
 */
function group<T extends { id: string }>(
  items: readonly T[],
  rules: readonly { reason: DuplicateReason; key: (item: T) => string }[],
): DuplicateGroup[] {
  const parent = new Map(items.map((item) => [item.id, item.id]));
  const root = (id: string): string => {
    const up = parent.get(id) ?? id;
    return up === id ? id : root(up);
  };
  const matches: { reason: DuplicateReason; ids: string[] }[] = [];
  for (const { reason, key } of rules) {
    const buckets = new Map<string, string[]>();
    for (const item of items) {
      const value = key(item);
      if (value) buckets.set(value, [...(buckets.get(value) ?? []), item.id]);
    }
    for (const ids of buckets.values()) {
      if (ids.length < 2) continue;
      matches.push({ reason, ids });
      for (const id of ids.slice(1)) parent.set(root(id), root(ids[0]));
    }
  }
  const groups = new Map<string, DuplicateGroup>();
  for (const item of items) {
    const key = root(item.id);
    if (!matches.some(({ ids }) => root(ids[0]) === key)) continue;
    groups.set(key, { ids: [...(groups.get(key)?.ids ?? []), item.id], reasons: [] });
  }
  for (const { reason, ids } of matches) {
    const found = groups.get(root(ids[0]));
    if (found && !found.reasons.includes(reason)) found.reasons.push(reason);
  }
  return [...groups.values()];
}

/** Locations with the same name, the same map point (to about 10 m) or the same street address. */
export function duplicateLocations(
  locations: readonly Location[],
  nameOf: (place: Location) => string,
): DuplicateGroup[] {
  return group(locations, [
    { reason: "name", key: (place) => normalize(nameOf(place)) },
    { reason: "coordinates", key: (place) => rounded(place.latitude, place.longitude, 4) },
    {
      reason: "address",
      key: (place) =>
        normalize(place.address_line1)
          ? [place.address_line1, place.locality, place.country_code].map(normalize).join("|")
          : "",
    },
  ]);
}

/** Areas with the same name in the same country, or the same map point (areas keep about 1 km). */
export function duplicateAreas(areas: readonly Area[]): DuplicateGroup[] {
  return group(areas, [
    {
      reason: "name",
      key: (area) =>
        normalize(areaName(area)) ? `${normalize(areaName(area))}|${area.country_code ?? ""}` : "",
    },
    { reason: "coordinates", key: (area) => rounded(area.latitude, area.longitude, 2) },
  ]);
}

/** Audience names the server returns, as data for a translated sentence. */
export type Audience =
  | { kind: "public" }
  | { kind: "link"; label: string }
  | { kind: "other"; name: string };

/** "public page" and `link '<label>'` (a Python repr) are the server's audience names. */
export function parseAudience(name: string): Audience {
  if (name === "public page") return { kind: "public" };
  const link = /^link (['"])(.*)\1$/s.exec(name);
  return link
    ? { kind: "link", label: link[2].replace(/\\(['"\\])/g, "$1") }
    : { kind: "other", name };
}
