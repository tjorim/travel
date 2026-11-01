import { captureSessionGeneration, decodeSubject, readSession } from "./auth";
import type { UpdateDraft, LocationInput } from "./tracker-model";

/** Editor metadata survives object spreads but is never serialized into tab recovery or API data. */
export const DRAFT_FENCE: unique symbol = Symbol();

const prefix = "travel-capture-draft-v3:";
export type DraftFence = {
  owner: string | null;
  generation: number;
  logout: string | null;
  raw: string | null;
  trip: string;
};

function subject(): string | null {
  try {
    const session = readSession();
    return session ? decodeSubject(session.accessToken) : null;
  } catch {
    return null;
  }
}
function key(owner: string, trip: string): string {
  return `${prefix}${encodeURIComponent(owner)}:${encodeURIComponent(trip)}`;
}
function rawDraft(owner: string | null, trip: string): string | null {
  return owner ? localStorage.getItem(key(owner, trip)) : null;
}
function fence(trip: string): DraftFence {
  const owner = subject();
  let raw = null;
  let logout = null;
  try {
    raw = rawDraft(owner, trip);
    logout = owner
      ? localStorage.getItem(`travel-capture-logout:${encodeURIComponent(owner)}`)
      : null;
  } catch {
    /* Online editing remains available. */
  }
  return { owner, trip, generation: captureSessionGeneration(), logout, raw };
}
export function emptyDraft(tripId = ""): UpdateDraft {
  const now = new Date();
  return {
    tripId,
    updateId: null,
    occurredAt: new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16),
    title: "",
    notes: "",
    location: null,
    mediaAssetIds: [],
    [DRAFT_FENCE]: fence(tripId),
  };
}

// Restore only known fields; never spread an untrusted object into a form/API payload.
function location(value: unknown): LocationInput | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string | number | null> = {};
  const strings = [
    "existing_location_id",
    "id",
    "label",
    "display_name",
    "osm_element_type",
    "osm_element_id",
    "address_line1",
    "address_line2",
    "locality",
    "admin_area",
    "postal_code",
    "country_code",
    "navigation_provider",
    "navigation_provider_place_id",
    "notes",
  ];
  const numbers = [
    "latitude",
    "longitude",
    "viewport_north",
    "viewport_south",
    "viewport_east",
    "viewport_west",
  ];
  for (const [name, field] of Object.entries(value)) {
    if (strings.includes(name)) {
      if (field !== null && typeof field !== "string") return undefined;
    } else if (numbers.includes(name)) {
      if (
        field !== null &&
        (typeof field !== "number" ||
          !Number.isFinite(field) ||
          Math.abs(field) >
            (name === "latitude" || name === "viewport_north" || name === "viewport_south"
              ? 90
              : 180))
      )
        return undefined;
    } else continue;
    result[name] = field as string | number | null;
  }
  return result;
}
function payload(value: unknown, trip: string): Omit<UpdateDraft, typeof DRAFT_FENCE> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const d = value as UpdateDraft;
  const place = location(d.location);
  if (
    d.tripId !== trip ||
    (d.updateId !== null && typeof d.updateId !== "string") ||
    typeof d.occurredAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(d.occurredAt) ||
    !Number.isFinite(Date.parse(d.occurredAt)) ||
    new Date(`${d.occurredAt}Z`).toISOString().slice(0, 16) !== d.occurredAt ||
    typeof d.title !== "string" ||
    typeof d.notes !== "string" ||
    place === undefined ||
    !Array.isArray(d.mediaAssetIds) ||
    !d.mediaAssetIds.every((id) => typeof id === "string" && id.length > 0)
  )
    return null;
  return {
    tripId: trip,
    updateId: d.updateId,
    occurredAt: d.occurredAt,
    title: d.title,
    notes: d.notes,
    location: place,
    mediaAssetIds: [...d.mediaAssetIds],
  };
}
export function readDraft(trip: string): UpdateDraft | null {
  const token = fence(trip);
  if (!token.owner || !token.raw) return null;
  try {
    const saved = JSON.parse(token.raw);
    if (saved.version !== 3 || saved.owner !== token.owner || typeof saved.revision !== "string")
      return null;
    const values = payload(saved.draft, trip);
    return values ? { ...values, [DRAFT_FENCE]: token } : null;
  } catch {
    return null;
  }
}
export function draftIsCurrent(draft: UpdateDraft): boolean {
  const token = draft[DRAFT_FENCE];
  if (
    !token?.owner ||
    token.trip !== draft.tripId ||
    token.owner !== subject() ||
    token.generation !== captureSessionGeneration()
  )
    return false;
  try {
    return (
      localStorage.getItem(`travel-capture-logout:${encodeURIComponent(token.owner)}`) ===
      token.logout
    );
  } catch {
    return true;
  }
}

export type DraftWriteResult = "saved" | "conflict" | "unavailable" | "inactive";
async function write(draft: UpdateDraft, clear: boolean): Promise<DraftWriteResult> {
  const token = draft[DRAFT_FENCE];
  if (!token || !draftIsCurrent(draft)) return "inactive";
  // Snapshot the values now, before waiting for another tab/local write.
  const values = clear ? null : payload(draft, draft.tripId);
  if (!clear && !values) return "unavailable";
  if (!navigator.locks?.request) return "unavailable";
  try {
    return await navigator.locks.request(key(token.owner!, token.trip), () => {
      if (!draftIsCurrent(draft)) return "inactive";
      if (rawDraft(token.owner, token.trip) !== token.raw) return "conflict";
      if (token.raw) {
        try {
          const prior = JSON.parse(token.raw);
          if (
            prior.version !== 3 ||
            prior.owner !== token.owner ||
            typeof prior.revision !== "string" ||
            (prior.draft !== null && !payload(prior.draft, token.trip))
          )
            return "conflict";
          if (JSON.stringify(prior.draft) === JSON.stringify(values)) return "saved";
        } catch {
          return "conflict";
        }
      }
      // Keep a tombstone so a stale editor cannot recreate a cleared draft (ABA).
      const raw = JSON.stringify({
        version: 3,
        owner: token.owner,
        revision: crypto.randomUUID(),
        draft: values,
      });
      const storageKey = key(token.owner!, token.trip);
      localStorage.setItem(storageKey, raw);
      // Logout does not wait for a lock. If another tab invalidated this editor
      // between the check and setItem, restore its previous pending draft while
      // still holding the trip lock, before any new editor can write.
      if (!draftIsCurrent(draft)) {
        if (token.raw === null) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, token.raw);
        return "inactive";
      }
      token.raw = raw;
      return "saved";
    });
  } catch {
    return "unavailable";
  }
}
export function saveDraft(draft: UpdateDraft): Promise<DraftWriteResult> {
  return write(draft, false);
}
export function clearDraft(draft: UpdateDraft): Promise<DraftWriteResult> {
  return write(draft, true);
}
