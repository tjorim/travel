import type { LocationInput, PlaceSearchResult } from "@/api-types";

/** The provider's own Dutch and English names for a place: suggestions for its labels, never stored unasked. */
export type SuggestedNames = { nl: string | null; en: string | null };

/**
 * A place-search result as a location to save, and the label suggestions kept apart from it. The suggestions are
 * not a field of a location (the API refuses them), so they never travel with the saved record by accident;
 * the local name is the owner's to keep and stays with the location.
 */
export function splitPlaceResult(result: PlaceSearchResult): {
  location: LocationInput;
  names: SuggestedNames;
} {
  const { name_nl, name_en, ...location } = result;
  return { location, names: { nl: name_nl, en: name_en } };
}

/** The suggestions that would change what is typed in the labels, so a button can offer exactly those. */
export function pendingNames(
  names: SuggestedNames | null,
  current: { nl: string; en: string },
): SuggestedNames | null {
  if (!names) return null;
  const nl = names.nl && names.nl !== current.nl.trim() ? names.nl : null;
  const en = names.en && names.en !== current.en.trim() ? names.en : null;
  return nl || en ? { nl, en } : null;
}
