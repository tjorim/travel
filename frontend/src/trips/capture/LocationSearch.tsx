import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { PlaceSearchResponse, PlaceSearchResult, UpdateDraft } from "../../tracker-model";
import { Field, FieldLabel, FieldLegend, FieldSet } from "../../ui/field";
import { SuggestionAside } from "./SuggestionAside";

type Gps = { latitude: number; longitude: number };

/** The optional place of the update: search, a photo's suggested coordinates, results and the chosen place. */
export function LocationSearch({
  candidateGps,
  query,
  location,
  state,
  results,
  onQueryChange,
  onSearch,
  onSelect,
  onClear,
  onFindPlace,
  onDismissCandidate,
}: {
  candidateGps: Gps | null;
  query: string;
  location: UpdateDraft["location"];
  state: string;
  results: PlaceSearchResponse | null;
  onQueryChange: (query: string) => void;
  onSearch: () => void;
  onSelect: (result: PlaceSearchResult) => void;
  onClear: () => void;
  onFindPlace: (gps: Gps) => void;
  onDismissCandidate: () => void;
}) {
  useLocale();
  return (
    <FieldSet className="location">
      <FieldLegend>{m.owner_location_entirely_optional()}</FieldLegend>
      <p>{m.owner_search_for_and_choose_a_location_it_is_only_created_as_a_private_locatio()}</p>
      {candidateGps && (
        <SuggestionAside>
          <strong>{m.owner_selected_location_from_candidate()}</strong>
          <span>
            {m.owner_this_exif_coordinate_stays_private_and_has_not_been_looked_up_or_saved_y()}
          </span>
          <div className="button-row">
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onFindPlace(candidateGps)}
            >
              {m.owner_search_this_candidate_place()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onDismissCandidate()}
            >
              {m.owner_dismiss_location()}
            </Button>
          </div>
        </SuggestionAside>
      )}
      <div className="field-row">
        <Field className="contents">
          <FieldLabel>
            {m.owner_search_for_a_location()}
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={m.owner_for_example_taipei_main_station()}
            />
          </FieldLabel>
        </Field>
        <div className="flex items-end">
          <Button className="secondary" type="button" onClick={onSearch}>
            {m.owner_search()}
          </Button>
        </div>
      </div>
      {location && (
        <p className="flex flex-wrap items-center gap-2">
          <strong>{m.owner_selected_location()}</strong>{" "}
          {location.display_name ?? location.locality ?? m.owner_unnamed_location()}{" "}
          <Button className="secondary compact" type="button" onClick={() => onClear()}>
            {m.owner_delete()}
          </Button>
        </p>
      )}
      {state && (
        <p className="help" role="status">
          {state}
        </p>
      )}
      {results && (
        <div className="grid gap-1.75">
          {results.results.map((result) => (
            <Button
              className="w-full border border-travel-border bg-travel-surface text-left font-semibold text-travel-ink"
              type="button"
              key={`${result.osm_element_type}-${result.osm_element_id}`}
              onClick={() => onSelect(result)}
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
