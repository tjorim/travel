import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Input } from "@base-ui/react/input";
import { useCallback, useRef } from "react";

import {
  AsyncSearchSelect,
  SearchSelect,
  type SearchSelectGroup,
  type SearchSelectOption,
} from "../forms/fields";
import {
  tripPath,
  useAreaSearch,
  useLocationSearch,
  useOwnerMutation,
  useTripResource,
} from "../query/owner-queries";
import {
  locationName,
  type Area,
  type AreaSuggestion,
  type Location,
  type LocationInput,
  type PlaceSearchResult,
  type Visit,
} from "../tracker-model";
import { PlaceSearchField } from "./PlaceSearchField";
import { Field, FieldError, FieldLabel, FieldSet, FieldLegend } from "../ui/field";

/**
 * Where something is: a whole area, a location in one, or a new location. A location is always
 * part of an area, so one choice says both. `choice` is "" (nothing yet), `area:<id>`,
 * `location:<id>` or `new`, which is completed by the fields below it.
 */
export type PlaceValue = {
  choice: string;
  newName: string;
  newLocality: string;
  newCountryCode: string;
  /** Existing area id, "__new__" for an accepted candidate, or empty for the city fallback. */
  newAreaId: string;
  newAreaCandidate: AreaSuggestion["area"] | null;
  /** The search result a new location started from (its address, point and provider reference). */
  newResult: LocationInput | null;
};

export const emptyPlace = (): PlaceValue => ({
  choice: "",
  newName: "",
  newLocality: "",
  newCountryCode: "",
  newAreaId: "",
  newAreaCandidate: null,
  newResult: null,
});

/** The value that shows what a record already points at. */
export function placeOf(area: Area, location: Location | null): PlaceValue {
  return { ...emptyPlace(), choice: location ? `location:${location.id}` : `area:${area.id}` };
}

export const placeOfVisit = (visit: Pick<Visit, "area" | "location">): PlaceValue =>
  placeOf(visit.area, visit.location);

export const hasPlace = (value: PlaceValue): boolean =>
  value.choice === "new"
    ? Boolean(value.newName.trim() || value.newLocality.trim() || value.newResult)
    : value.choice !== "";

export const samePlace = (left: PlaceValue, right: PlaceValue): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * The request fields for a place, named `<prefix>area_id` and `<prefix>location`. A whole area also
 * clears any location, so moving a record from a hotel to its city really does that.
 */
export function placeFields(value: PlaceValue, prefix = ""): Record<string, unknown> {
  const [kind, id] = value.choice.split(":");
  if (kind === "area") return { [`${prefix}area_id`]: id, [`${prefix}location`]: null };
  if (kind === "location") return { [`${prefix}location`]: { existing_location_id: id } };
  if (value.choice === "new") {
    return {
      [`${prefix}location`]: {
        ...value.newResult,
        display_name: value.newName.trim() || null,
        locality: value.newLocality.trim() || null,
        country_code: value.newCountryCode.trim().toUpperCase() || null,
        ...(value.newAreaId === "__new__" && value.newAreaCandidate
          ? { new_area: value.newAreaCandidate }
          : value.newAreaId
            ? { area_id: value.newAreaId }
            : {}),
      },
    };
  }
  return {};
}

/** One picker for a place: areas with their locations nested, and a way to add a new location. */
export function PlacePicker({
  tripId,
  label,
  value,
  onChange,
  hint,
  error,
}: {
  tripId: string;
  label: string;
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  hint?: string;
  /** Why the chosen place cannot be used yet, shown under the picker. */
  error?: string | null;
}) {
  useLocale();
  const currentValue = useRef(value);
  currentValue.current = value;
  const areas = useTripResource(tripId, "areas").data ?? [];
  const locations = useTripResource(tripId, "locations").data ?? [];
  const searchAreas = useAreaSearch(tripId);
  const searchLocations = useLocationSearch(tripId);
  const suggestion = useOwnerMutation<
    { latitude: number; longitude: number; city?: string },
    AreaSuggestion
  >({
    fallback: m.owner_an_area_could_not_be_suggested,
    request: (body) => ({ path: tripPath(tripId, "areas/suggest"), method: "POST", body }),
    invalidate: () => [],
    gcTime: 0,
  });
  const loadPlaces = useCallback(
    async (query: string): Promise<(SearchSelectOption | SearchSelectGroup)[]> => {
      const [matchingAreas, matchingLocations] = await Promise.all([
        searchAreas(query),
        searchLocations(query),
      ]);
      const grouped = new Map<string, { area: Area; places: Location[] }>();
      for (const area of matchingAreas) grouped.set(area.id, { area, places: [] });
      for (const location of matchingLocations) {
        const area = areas.find((item) => item.id === location.area_id);
        if (area && !grouped.has(area.id)) grouped.set(area.id, { area, places: [] });
        grouped.get(location.area_id)?.places.push(location);
      }
      return [
        {
          value: "",
          get label() {
            return m.owner_choose_an_area_or_location();
          },
        },
        ...[...grouped.values()].map(({ area, places }) => ({
          label: `${area.label}${area.region ? ` · ${area.region}` : ""}`,
          options: [
            {
              value: `area:${area.id}`,
              get label() {
                return m.owner_whole_area({ p0: area.label });
              },
            },
            ...places.map((location) => ({
              value: `location:${location.id}`,
              label: locationName(location),
            })),
          ],
        })),
        {
          value: "new",
          get label() {
            return m.owner_new_location();
          },
        },
      ];
    },
    [areas, searchAreas, searchLocations],
  );
  const selectedOption =
    value.choice === "new"
      ? {
          value: "new",
          get label() {
            return m.owner_new_location();
          },
        }
      : value.choice.startsWith("area:")
        ? {
            value: value.choice,
            label: m.owner_whole_area({
              p0: areas.find((area) => area.id === value.choice.slice(5))?.label ?? value.choice,
            }),
          }
        : value.choice.startsWith("location:")
          ? {
              value: value.choice,
              label: locationName(
                locations.find((location) => location.id === value.choice.slice(9)) ?? {},
              ),
            }
          : null;
  async function useResult(result: PlaceSearchResult) {
    const next = {
      ...value,
      choice: "new",
      newResult: result,
      newName: result.display_name ?? "",
      newLocality: result.locality ?? "",
      newCountryCode: result.country_code ?? "",
      newAreaId: "",
      newAreaCandidate: null,
    };
    onChange(next);
    if (result.latitude == null || result.longitude == null) return;
    try {
      const proposed = await suggestion.mutateAsync({
        latitude: result.latitude,
        longitude: result.longitude,
        city: result.locality ?? undefined,
      });
      if (
        currentValue.current.newResult?.latitude === result.latitude &&
        currentValue.current.newResult?.longitude === result.longitude &&
        !currentValue.current.newAreaId
      ) {
        onChange({
          ...currentValue.current,
          newAreaId: proposed.existing_area_id ?? "__new__",
          newAreaCandidate: proposed.existing_area_id ? null : proposed.area,
        });
      }
    } catch {
      /* Owner can still choose an area or use the city fallback. */
    }
  }

  return (
    <FieldSet>
      <FieldLegend>{label}</FieldLegend>
      <Field invalid={Boolean(error)}>
        <FieldLabel>{m.owner_choose_field({ label })}</FieldLabel>
        <AsyncSearchSelect
          ariaLabel={label}
          value={value.choice}
          selectedOption={selectedOption}
          defaultOptions={[
            {
              value: "",
              get label() {
                return m.owner_choose_an_area_or_location();
              },
            },
            ...areas.slice(0, 50).map((area) => ({
              label: `${area.label}${area.region ? ` · ${area.region}` : ""}`,
              options: [
                {
                  value: `area:${area.id}`,
                  get label() {
                    return m.owner_whole_area({ p0: area.label });
                  },
                },
                ...locations
                  .slice(0, 50)
                  .filter((location) => location.area_id === area.id)
                  .map((location) => ({
                    value: `location:${location.id}`,
                    label: locationName(location),
                  })),
              ],
            })),
            {
              value: "new",
              get label() {
                return m.owner_new_location();
              },
            },
          ]}
          loadOptions={loadPlaces}
          onChange={(next) =>
            onChange(
              next === "new"
                ? { ...emptyPlace(), choice: "new" }
                : { ...emptyPlace(), choice: next },
            )
          }
        />
        <FieldError>{error}</FieldError>
      </Field>
      {hint && <p className="help">{hint}</p>}
      {value.choice === "new" && (
        <div>
          <PlaceSearchField
            tripId={tripId}
            legend={m.owner_search_location()}
            inputLabel={m.owner_search_location_2({ p0: label })}
            placeholder={m.owner_for_example_taipei_main_station()}
            help={m.owner_a_selected_location_stays_private_check_the_suggested_area_before_saving()}
            onSelect={(result) => void useResult(result)}
          />
          <div className="field-row">
            <Field>
              <FieldLabel>
                {m.owner_name()}{" "}
                <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                <Input
                  aria-label={m.owner_name_2({ p0: label })}
                  value={value.newName}
                  maxLength={500}
                  onChange={(event) => onChange({ ...value, newName: event.target.value })}
                />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel>
                {m.owner_city()}{" "}
                <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                <Input
                  aria-label={m.owner_city_2({ p0: label })}
                  value={value.newLocality}
                  maxLength={120}
                  onChange={(event) => onChange({ ...value, newLocality: event.target.value })}
                />
              </FieldLabel>
            </Field>
          </div>
          <div className="field-row">
            <Field>
              <FieldLabel>
                {m.owner_country_code()}{" "}
                <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
                <Input
                  aria-label={m.owner_country_code_3({ p0: label })}
                  value={value.newCountryCode}
                  maxLength={2}
                  onChange={(event) => onChange({ ...value, newCountryCode: event.target.value })}
                />
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel>
                {m.owner_area()}{" "}
                <span className="font-medium text-travel-optional">{m.owner_optional()}</span>
              </FieldLabel>
              <SearchSelect
                ariaLabel={m.owner_new_location_s_area({ p0: label })}
                value={value.newAreaId}
                onChange={(next) => onChange({ ...value, newAreaId: next })}
              >
                <option value="">
                  {value.newResult?.latitude != null
                    ? m.owner_do_not_use_a_suggestion_city_rule()
                    : m.owner_derive_from_the_city()}
                </option>
                {value.newAreaCandidate && (
                  <option value="__new__">
                    {m.owner_new_area()} {value.newAreaCandidate.label}
                    {value.newAreaCandidate.timezone ? ` · ${value.newAreaCandidate.timezone}` : ""}
                  </option>
                )}
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.label}
                  </option>
                ))}
              </SearchSelect>
            </Field>
          </div>
          {value.newAreaId === "__new__" && value.newAreaCandidate && (
            <div className="field-row">
              <Field>
                <FieldLabel>
                  {m.owner_new_area_name()}
                  <Input
                    value={value.newAreaCandidate.label}
                    maxLength={120}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        newAreaCandidate: { ...value.newAreaCandidate!, label: event.target.value },
                      })
                    }
                  />
                </FieldLabel>
              </Field>
              <Field>
                <FieldLabel>
                  {m.owner_new_area_time_zone()}
                  <Input
                    value={value.newAreaCandidate.timezone ?? ""}
                    maxLength={64}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        newAreaCandidate: {
                          ...value.newAreaCandidate!,
                          timezone: event.target.value || null,
                        },
                      })
                    }
                  />
                </FieldLabel>
              </Field>
            </div>
          )}
        </div>
      )}
    </FieldSet>
  );
}
