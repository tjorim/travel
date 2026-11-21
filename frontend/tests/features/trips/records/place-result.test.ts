import { expect, it } from "vitest";

import type { PlaceSearchResult } from "@/api-types";
import { pendingNames, splitPlaceResult } from "@/features/trips/records/place-result";
import { namesTheArea } from "@/features/trips/areas/model";

const result: PlaceSearchResult = {
  osm_element_type: "relation",
  osm_element_id: "1",
  display_name: "Taipei, Taiwan",
  latitude: 25.03,
  longitude: 121.56,
  address_line1: null,
  address_line2: null,
  locality: "Taipei",
  admin_area: null,
  postal_code: null,
  country_code: "TW",
  local_name: "臺北市",
  name_nl: "Taipei",
  name_en: "Taipei City",
  viewport_north: null,
  viewport_south: null,
  viewport_east: null,
  viewport_west: null,
};

it("keeps the suggested names apart from the location a result becomes", () => {
  const { location, names } = splitPlaceResult(result);
  // The API refuses a location with the suggestions in it; the local name belongs to the location.
  expect(location).not.toHaveProperty("name_nl");
  expect(location).not.toHaveProperty("name_en");
  expect(location.local_name).toBe("臺北市");
  expect(names).toEqual({ nl: "Taipei", en: "Taipei City" });
});

it("offers only the suggestions that would change what is typed", () => {
  const names = { nl: "Taipei", en: "Taipei City" };
  expect(pendingNames(null, { nl: "", en: "" })).toBeNull();
  expect(pendingNames(names, { nl: "", en: "" })).toEqual(names);
  expect(pendingNames(names, { nl: "Taipei ", en: "" })).toEqual({ nl: null, en: "Taipei City" });
  expect(pendingNames(names, { nl: "Taipei", en: "Taipei City" })).toBeNull();
  expect(pendingNames({ nl: null, en: null }, { nl: "", en: "" })).toBeNull();
});

it("takes a result's names for an area only when the result is the city or region itself", () => {
  expect(namesTheArea(result)).toBe(true);
  // A station inside the city names something else: its local name is not the city's.
  expect(
    namesTheArea({ ...result, display_name: "Taipei Main Station, Zhongzheng, Taipei, Taiwan" }),
  ).toBe(false);
  expect(
    namesTheArea({
      ...result,
      locality: null,
      admin_area: "Hokkaido",
      display_name: "Hokkaido, Japan",
    }),
  ).toBe(true);
  expect(namesTheArea({ ...result, display_name: "" })).toBe(false);
});
