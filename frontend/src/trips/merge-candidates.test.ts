import { expect, it } from "vitest";

import type { Area, Location } from "../tracker-model";
import { duplicateAreas, duplicateLocations, parseAudience } from "./merge-candidates";

const place = (id: string, fields: Partial<Location> = {}) =>
  ({ id, area_id: "a1", display_name: null, label: null, ...fields }) as Location;
const nameOf = (value: Location) => value.display_name ?? "";
const area = (id: string, fields: Partial<Area> = {}) =>
  ({ id, label: id, country_code: null, latitude: null, longitude: null, ...fields }) as Area;

it("suggests locations with the same name, ignoring case, accents and punctuation", () => {
  const groups = duplicateLocations(
    [
      place("a", { display_name: "Taoyuan Airport" }),
      place("b", { display_name: "Café Zürich" }),
      place("c", { display_name: "  taoyuan  AIRPORT " }),
      place("d", { display_name: "Cafe Zurich!" }),
      place("e", { display_name: "Alone" }),
    ],
    nameOf,
  );
  expect(groups).toEqual([
    { ids: ["a", "c"], reasons: ["name"] },
    { ids: ["b", "d"], reasons: ["name"] },
  ]);
});

it("suggests locations on the same map point or street address, and joins overlapping matches", () => {
  const groups = duplicateLocations(
    [
      place("a", { display_name: "Hotel", latitude: 25.0777, longitude: 121.2322 }),
      place("b", { display_name: "Airport", latitude: 25.07772, longitude: 121.23221 }),
      place("c", { display_name: "Airport", address_line1: "1 Main St", locality: "Taipei" }),
      place("d", { display_name: "Terminal", address_line1: "1 main st.", locality: "taipei" }),
      place("far", { display_name: "Far", latitude: 26, longitude: 121.2322 }),
    ],
    nameOf,
  );
  expect(groups).toEqual([{ ids: ["a", "b", "c", "d"], reasons: ["name", "coordinates", "address"] }]);
});

it("never matches records that have no name, point or address to compare", () => {
  expect(duplicateLocations([place("a"), place("b")], nameOf)).toEqual([]);
  expect(duplicateLocations([place("a", { address_line1: "  " }), place("b", { address_line1: "" })], nameOf)).toEqual(
    [],
  );
});

it("suggests areas by name within a country, or by the same map point", () => {
  expect(
    duplicateAreas([
      area("Taipei", { country_code: "TW" }),
      area("taipei", { country_code: "TW" }),
      area("Paris", { country_code: "FR" }),
      area("Paris", { country_code: "US" }),
      area("North", { latitude: 25.03, longitude: 121.56 }),
      area("South", { latitude: 25.031, longitude: 121.559 }),
    ]),
  ).toEqual([
    { ids: ["Taipei", "taipei"], reasons: ["name"] },
    { ids: ["North", "South"], reasons: ["coordinates"] },
  ]);
});

it("reads the server's audience names as data", () => {
  expect(parseAudience("public page")).toEqual({ kind: "public" });
  expect(parseAudience("link 'Family'")).toEqual({ kind: "link", label: "Family" });
  expect(parseAudience(`link "Jorim's trip"`)).toEqual({ kind: "link", label: "Jorim's trip" });
  expect(parseAudience("something else")).toEqual({ kind: "other", name: "something else" });
});
