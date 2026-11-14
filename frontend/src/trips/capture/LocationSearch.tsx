import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { PlaceSearchResponse, LocationInput } from "../../api-types";
import type { UpdateDraft } from "../../capture-draft";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
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
  onSelect: (result: LocationInput) => void;
  onClear: () => void;
  onFindPlace: (gps: Gps) => void;
  onDismissCandidate: () => void;
}) {
  useLocale();
  return (
    <FieldSet className="location">
      <FieldLegend>{m.capture_location_entirely_optional()}</FieldLegend>
      <p>{m.capture_location_search_hint()}</p>
      {candidateGps && (
        <SuggestionAside>
          <strong>{m.capture_selected_location_from_candidate()}</strong>
          <span>{m.capture_exif_coordinate_hint()}</span>
          <div className="button-row">
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onFindPlace(candidateGps)}
            >
              {m.capture_search_this_candidate_place()}
            </Button>
            <Button
              className="secondary compact"
              type="button"
              onClick={() => onDismissCandidate()}
            >
              {m.media_dismiss_location()}
            </Button>
          </div>
        </SuggestionAside>
      )}
      <div className="field-row">
        <Field className="contents">
          <FieldLabel>
            {m.capture_search_for_a_location()}
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={m.locations_for_example_taipei_main_station()}
            />
          </FieldLabel>
        </Field>
        <div className="flex items-end">
          <Button className="secondary" type="button" onClick={onSearch}>
            {m.packing_search()}
          </Button>
        </div>
      </div>
      {location && (
        <p className="flex flex-wrap items-center gap-2">
          <strong>{m.updates_selected_location()}</strong>{" "}
          {location.display_name ?? location.locality ?? m.common_unnamed_location()}{" "}
          <Button className="secondary compact" type="button" onClick={() => onClear()}>
            {m.common_delete()}
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
            {m.locations_search_results()}{" "}
            <a href={results.attribution_url} target="_blank" rel="noreferrer">
              {results.attribution}
            </a>
          </p>
        </div>
      )}
    </FieldSet>
  );
}
