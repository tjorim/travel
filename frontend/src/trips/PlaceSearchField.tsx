import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { textNotice, errorNotice, useFeedback } from "../query/feedback";
import { Input } from "@base-ui/react/input";
import { Button } from "@base-ui/react/button";
import { useRef, useState } from "react";

import { AsyncSearchSelect } from "../forms/fields";

import { tripPath, useLocationSearch, useOwnerMutation } from "../query/owner-queries";
import {
  locationName,
  type Location,
  type PlaceSearchResponse,
  type PlaceSearchResult,
} from "../tracker-model";
import { Field, FieldLabel, FieldSet, FieldLegend } from "../ui/field";

/** Owner-only place lookup that never persists a selected result by itself. */
export function PlaceSearchField({
  tripId,
  legend,
  inputLabel,
  placeholder,
  help,
  onSelect,
  allowExisting = false,
  current,
}: {
  tripId: string;
  legend: string;
  inputLabel: string;
  placeholder: string;
  help: string;
  /** Existing locations include their full owner-only data for pre-filling adjacent fields. */
  onSelect: (result: PlaceSearchResult, existingPlace?: Location) => void;
  /** Location-based editors may reuse a saved private location; area search must not. */
  allowExisting?: boolean;
  /** Names the place the record is already linked to, shown until a new one is chosen. */
  current?: string;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResponse | null>(null);
  const [state, setState] = useFeedback<string>("");
  const [existingChoice, setExistingChoice] = useState("");
  const existingResults = useRef(new Map<string, Location>());
  const searchExisting = useLocationSearch(tripId);
  // A lookup phrase can be sensitive, so it is not retained in the mutation cache.
  const search = useOwnerMutation<{ query: string }, PlaceSearchResponse>({
    fallback: m.owner_location_search_is_currently_unavailable,
    request: ({ query: phrase }) => ({
      path: tripPath(tripId, "places/search"),
      method: "POST",
      body: { query: phrase },
    }),
    invalidate: () => [],
    gcTime: 0,
  });
  function find() {
    if (query.trim().length < 2) {
      setState(textNotice(() => m.owner_enter_at_least_two_characters_to_search_for_a_location()));
      return;
    }
    setState(textNotice(() => m.owner_searching_locations()));
    search.mutateAsync({ query: query.trim() }).then(
      (response) => {
        setResults(response);
        setState(
          textNotice(() =>
            response.results.length
              ? m.owner_choose_a_result_as_a_starting_point_nothing_is_saved_yet()
              : m.owner_no_locations_found(),
          ),
        );
      },
      (error: unknown) => setState(errorNotice(error, m.owner_location_search_failed)),
    );
  }
  function choose(result: PlaceSearchResult) {
    onSelect(result);
    setResults(null);
    setState(textNotice(() => m.owner_location_suggested_all_fields_remain_editable()));
  }
  function chooseExisting(place: Location) {
    onSelect({ existing_location_id: place.id }, place);
    setResults(null);
    setState(textNotice(() => m.owner_existing_location_selected_no_copy_is_created()));
  }
  return (
    <FieldSet className="m-0 grid gap-2.5 rounded-travel-media border border-travel-divider p-3 [&>p]:m-0 [&>p]:text-sm [&>p]:leading-normal [&>p]:text-travel-muted">
      <FieldLegend>
        {legend} <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
      </FieldLegend>
      <p>{help}</p>
      {allowExisting && (
        <Field>
          <FieldLabel>{m.owner_use_an_existing_location()}</FieldLabel>
          <AsyncSearchSelect
            ariaLabel={m.owner_use_an_existing_location()}
            value={existingChoice}
            onChange={(value) => {
              const place = existingResults.current.get(value);
              if (place) chooseExisting(place);
              setExistingChoice("");
            }}
            loadOptions={async (phrase) => {
              const places = await searchExisting(phrase);
              for (const place of places) existingResults.current.set(place.id, place);
              return places.map((place) => ({
                value: place.id,
                label: `${locationName(place)}${place.locality ? ` · ${place.locality}` : ""}`,
              }));
            }}
          />
          <small className="help">{m.owner_type_a_name_to_search_saved_locations()}</small>
        </Field>
      )}
      <div className="flex flex-col gap-3 min-[560px]:flex-row min-[560px]:items-end">
        <Field className="contents">
          <FieldLabel className="min-[560px]:flex-1">
            {inputLabel}
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
            />
          </FieldLabel>
        </Field>
        <div className="flex items-end">
          <Button className="secondary" type="button" onClick={find}>
            {m.owner_search()}
          </Button>
        </div>
      </div>
      {(state || current) && (
        <p className="help" role="status">
          {state || current}
        </p>
      )}
      {results && (
        <div className="grid gap-1.75">
          {results.results.map((result) => (
            <Button
              className="w-full border border-travel-border bg-travel-surface text-left font-semibold text-travel-ink"
              type="button"
              key={`${result.osm_element_type}-${result.osm_element_id}`}
              onClick={() => choose(result)}
            >
              {result.display_name}
            </Button>
          ))}
          <p className="help">
            {m.owner_search_results()}{" "}
            <a href={results.attribution_url} target="_blank" rel="noreferrer">
              {results.attribution}
            </a>
          </p>
        </div>
      )}
    </FieldSet>
  );
}
