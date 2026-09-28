import { useRef, useState } from "react";

import { AsyncSearchSelect } from "../forms/fields";
import { errorMessage } from "../query/api";
import { tripPath, useLocationSearch, useOwnerMutation } from "../query/owner-queries";
import { locationName, type Location, type PlaceSearchResponse, type PlaceSearchResult } from "../tracker-model";

/** Owner-only place lookup that never persists a selected result by itself. */
export function PlaceSearchField({
  tripId,
  legend,
  inputLabel,
  placeholder,
  help,
  onSelect,
  allowExisting = false,
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
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResponse | null>(null);
  const [state, setState] = useState("");
  const [existingChoice, setExistingChoice] = useState("");
  const existingResults = useRef(new Map<string, Location>());
  const searchExisting = useLocationSearch(tripId);
  // A lookup phrase can be sensitive, so it is not retained in the mutation cache.
  const search = useOwnerMutation<{ query: string }, PlaceSearchResponse>({
    fallback: "Locaties zoeken is nu niet beschikbaar.",
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
      setState("Vul minstens twee tekens in om een locatie te zoeken.");
      return;
    }
    setState("Locaties zoeken…");
    search.mutateAsync({ query: query.trim() }).then(
      (response) => {
        setResults(response);
        setState(
          response.results.length
            ? "Kies een resultaat als uitgangspunt. Er wordt nog niets opgeslagen."
            : "Geen locaties gevonden.",
        );
      },
      (error: unknown) => setState(errorMessage(error, "Locaties zoeken is mislukt.")),
    );
  }
  function choose(result: PlaceSearchResult) {
    onSelect(result);
    setResults(null);
    setState("Locatie voorgesteld; alle velden blijven bewerkbaar.");
  }
  function chooseExisting(place: Location) {
    onSelect({ existing_location_id: place.id }, place);
    setResults(null);
    setState("Bestaande locatie gekozen; er wordt geen kopie gemaakt.");
  }
  return (
    <fieldset className="place-lookup">
      <legend>
        {legend} <span className="optional">(optioneel)</span>
      </legend>
      <p>{help}</p>
      {allowExisting && (
        <label>
          Gebruik een bestaande locatie
          <AsyncSearchSelect
            ariaLabel="Gebruik een bestaande locatie"
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
          <small className="help">Typ een naam om opgeslagen locaties te zoeken.</small>
        </label>
      )}
      <div className="field-row">
        <label>
          {inputLabel}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
        </label>
        <div className="button-field">
          <button className="secondary" type="button" onClick={find}>
            Zoeken
          </button>
        </div>
      </div>
      {state && (
        <p className="help" role="status">
          {state}
        </p>
      )}
      {results && (
        <div className="place-results">
          {results.results.map((result) => (
            <button
              className="place-result"
              type="button"
              key={`${result.osm_element_type}-${result.osm_element_id}`}
              onClick={() => choose(result)}
            >
              {result.display_name}
            </button>
          ))}
          <p className="help">
            Zoekresultaten:{" "}
            <a href={results.attribution_url} target="_blank" rel="noreferrer">
              {results.attribution}
            </a>
          </p>
        </div>
      )}
    </fieldset>
  );
}
