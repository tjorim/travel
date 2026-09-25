import { useState } from "react";

import { errorMessage } from "../query/api";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { spotName, type Place, type PlaceSearchResponse, type PlaceSearchResult } from "../tracker-model";

/** Owner-only place lookup that never persists a selected result by itself. */
export function PlaceSearchField({ tripId, legend, inputLabel, placeholder, help, onSelect, allowExisting = false }: {
  tripId: string;
  legend: string;
  inputLabel: string;
  placeholder: string;
  help: string;
  /** Existing spots include their full owner-only data for pre-filling adjacent fields. */
  onSelect: (result: PlaceSearchResult, existingPlace?: Place) => void;
  /** Spot-based editors may reuse a saved private spot; broad-place search must not. */
  allowExisting?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResponse | null>(null);
  const [state, setState] = useState("");
  const existingQuery = useTripResource(allowExisting ? tripId : null, "places");
  const existing = existingQuery.data ?? [];
  // A lookup phrase can be sensitive, so it is not retained in the mutation cache.
  const search = useOwnerMutation<{ query: string }, PlaceSearchResponse>({
    fallback: "Plaatsen zoeken is nu niet beschikbaar.",
    request: ({ query: phrase }) => ({ path: tripPath(tripId, "places/search"), method: "POST", body: { query: phrase } }),
    invalidate: () => [],
    gcTime: 0,
  });
  function find() {
    if (query.trim().length < 2) { setState("Vul minstens twee tekens in om een plaats te zoeken."); return; }
    setState("Plaatsen zoeken…");
    search.mutateAsync({ query: query.trim() }).then((response) => {
      setResults(response);
      setState(response.results.length ? "Kies een resultaat als uitgangspunt. Er wordt nog niets opgeslagen." : "Geen plaatsen gevonden.");
    }, (error: unknown) => setState(errorMessage(error, "Plaatsen zoeken is mislukt.")));
  }
  function choose(result: PlaceSearchResult) {
    onSelect(result);
    setResults(null);
    setState("Plaats voorgesteld; alle velden blijven bewerkbaar.");
  }
  function chooseExisting(place: Place) {
    onSelect({ existing_place_id: place.id }, place);
    setResults(null);
    setState("Bestaande plek gekozen; er wordt geen kopie gemaakt.");
  }
  return <fieldset className="place-lookup"><legend>{legend} <span className="optional">(optioneel)</span></legend><p>{help}</p>
    {allowExisting && existing.length > 0 && <label>Gebruik een bestaande plek
      <select aria-label="Gebruik een bestaande plek" defaultValue="" onChange={(event) => {
        const place = existing.find((item) => item.id === event.target.value);
        if (place) chooseExisting(place);
        event.currentTarget.value = "";
      }}>
        <option value="">Kies een eerder opgeslagen plek</option>
        {existing.map((place) => <option key={place.id} value={place.id}>{spotName(place)}{place.locality ? ` · ${place.locality}` : ""}</option>)}
      </select>
    </label>}
    <div className="field-row"><label>{inputLabel}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} /></label><div className="button-field"><button className="secondary" type="button" onClick={find}>Zoeken</button></div></div>
    {state && <p className="help" role="status">{state}</p>}
    {results && <div className="place-results">{results.results.map((result) => <button className="place-result" type="button" key={`${result.osm_element_type}-${result.osm_element_id}`} onClick={() => choose(result)}>{result.display_name}</button>)}<p className="help">Zoekresultaten: <a href={results.attribution_url} target="_blank" rel="noreferrer">{results.attribution}</a></p></div>}
  </fieldset>;
}
