import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorNotice, textNotice, useFeedback } from "../../query/feedback";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type { PlaceSearchResponse } from "../../api-types";

type Gps = { latitude: number; longitude: number };

/**
 * The capture dialog's private place lookup: the typed search, a photo's coordinates, the results
 * and their status line. A search phrase or a photo's coordinates are private, so those calls are
 * dropped from the mutation cache once settled.
 */
export function usePlaceSearch(tripId: string | null, signedIn: boolean) {
  useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResponse | null>(null);
  const [state, setState] = useFeedback<string>("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [candidateGps, setCandidateGps] = useState<Gps | null>(null);
  const searchPlaces = useOwnerMutation<{ tripId: string; query: string }, PlaceSearchResponse>({
    fallback: m.locations_location_search_is_currently_unavailable,
    request: ({ tripId, query }) => ({
      path: tripPath(tripId, "places/search"),
      method: "POST",
      body: { query },
    }),
    invalidate: () => [],
    gcTime: 0,
  });
  const reversePlaces = useOwnerMutation<
    { tripId: string; latitude: number; longitude: number },
    PlaceSearchResponse
  >({
    fallback: m.capture_this_photo_s_location_could_not_be_looked_up,
    request: ({ tripId, latitude, longitude }) => ({
      path: tripPath(tripId, "places/reverse"),
      method: "POST",
      body: { latitude, longitude },
    }),
    invalidate: () => [],
    gcTime: 0,
  });

  function reset() {
    setQuery("");
    setResults(null);
    setState("");
    setDismissedSuggestions([]);
    setCandidateGps(null);
  }

  /** Called once a result has been chosen: the results are closed and the status says nothing is saved yet. */
  function chosen() {
    setState(textNotice(() => m.capture_location_selected_notice()));
    setResults(null);
  }

  function search() {
    if (!signedIn || !tripId || query.trim().length < 2) {
      setState(textNotice(() => m.locations_search_min_length_hint()));
      return;
    }
    setState(textNotice(() => m.locations_searching_locations()));
    searchPlaces.mutateAsync({ tripId, query: query.trim() }).then(
      (result) => {
        setResults(result);
        setState(
          textNotice(() =>
            result.results.length
              ? m.capture_choose_a_result_nothing_is_saved_yet()
              : m.locations_no_locations_found(),
          ),
        );
      },
      (error: unknown) => setState(errorNotice(error, m.locations_location_search_failed)),
    );
  }

  function reverseGeocode(gps: Gps) {
    if (!signedIn || !tripId) return;
    setState(textNotice(() => m.capture_looking_up_the_photo_location_only_for_you()));
    reversePlaces.mutateAsync({ tripId, ...gps }).then(
      (result) => {
        setResults(result);
        setState(
          textNotice(() =>
            result.results.length
              ? m.capture_choose_the_suggested_location_nothing_is_saved_yet()
              : m.capture_no_place_found_for_this_photo_location(),
          ),
        );
      },
      (error: unknown) =>
        setState(errorNotice(error, m.capture_this_photo_s_location_could_not_be_looked_up)),
    );
  }

  return {
    query,
    setQuery,
    results,
    state,
    dismissedSuggestions,
    setDismissedSuggestions,
    candidateGps,
    setCandidateGps,
    reset,
    chosen,
    search,
    reverseGeocode,
  };
}
