import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorNotice, textNotice, useFeedback } from "../../query/feedback";
import { tripPath, useOwnerMutation } from "../../query/owner-queries";
import type { PlaceSearchResponse } from "../../tracker-model";

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
    fallback: m.owner_location_search_is_currently_unavailable,
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
    fallback: m.owner_this_photo_s_location_could_not_be_looked_up,
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
    setState(
      textNotice(() =>
        m.owner_location_selected_it_will_only_be_created_when_you_save_the_travel_updat(),
      ),
    );
    setResults(null);
  }

  function search() {
    if (!signedIn || !tripId || query.trim().length < 2) {
      setState(textNotice(() => m.owner_enter_at_least_two_characters_to_search_for_a_location()));
      return;
    }
    setState(textNotice(() => m.owner_searching_locations()));
    searchPlaces.mutateAsync({ tripId, query: query.trim() }).then(
      (result) => {
        setResults(result);
        setState(
          textNotice(() =>
            result.results.length
              ? m.owner_choose_a_result_nothing_is_saved_yet()
              : m.owner_no_locations_found(),
          ),
        );
      },
      (error: unknown) => setState(errorNotice(error, m.owner_location_search_failed)),
    );
  }

  function reverseGeocode(gps: Gps) {
    if (!signedIn || !tripId) return;
    setState(textNotice(() => m.owner_looking_up_the_photo_location_only_for_you()));
    reversePlaces.mutateAsync({ tripId, ...gps }).then(
      (result) => {
        setResults(result);
        setState(
          textNotice(() =>
            result.results.length
              ? m.owner_choose_the_suggested_location_nothing_is_saved_yet()
              : m.owner_no_place_found_for_this_photo_location(),
          ),
        );
      },
      (error: unknown) =>
        setState(errorNotice(error, m.owner_this_photo_s_location_could_not_be_looked_up)),
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
