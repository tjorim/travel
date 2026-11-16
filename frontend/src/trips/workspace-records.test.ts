import { expect, it } from "vitest";

import type { Area, Location, MediaAsset, Route, TripTask } from "../api-types";
import { matchesQuery, RECORDS_PER_KIND, searchRecords } from "./workspace-records";

const area = (label: string) => ({ id: label, label }) as Area;
const photo = (name: string, id = name) => ({ id, original_filename: name }) as MediaAsset;

it("matches every word, ignoring case and accents", () => {
  expect(matchesQuery("Café Hotel Taipei", "CAFE taipei")).toBe(true);
  expect(matchesQuery("Café Hotel Taipei", "cafe tokyo")).toBe(false);
  expect(matchesQuery("anything", "  ")).toBe(true);
});

it("labels a match with its tab and block, in workspace order", () => {
  const found = searchRecords(
    {
      tasks: [{ id: "k1", title: "Taipei visum" } as TripTask],
      areas: [area("Taipei")],
      routes: [{ id: "r1", label: "Naar Taipei" } as Route],
    },
    "taipei",
  );
  expect(found.map((match) => match.label)).toEqual([
    "Plan › Gebieden en locaties › Taipei",
    "Plan › Agenda › Naar Taipei",
    "Voorbereiden › Nog te regelen › Taipei visum",
  ]);
});

it("finds an area or a location by its local name too, without showing it", () => {
  const found = searchRecords(
    {
      areas: [{ id: "a", label: "Taipei", local_name: "臺北" } as Area],
      locations: [{ id: "l", label: "Hotel", local_name: "河畔飯店" } as Location],
    },
    "臺北",
  );
  expect(found.map((match) => match.label)).toEqual(["Plan › Gebieden en locaties › Taipei"]);
  expect(
    searchRecords(
      { locations: [{ id: "l", label: "Hotel", local_name: "河畔飯店" } as Location] },
      "河畔",
    ),
  ).toHaveLength(1);
});

it("ignores a list that has not loaded", () => {
  expect(searchRecords({}, "a")).toEqual([]);
});

it("caps each kind and says how many more there are", () => {
  const media = Array.from({ length: RECORDS_PER_KIND + 3 }, (_, index) =>
    photo(`Strand ${index}`),
  );
  const found = searchRecords({ media, areas: [area("Strand")] }, "strand");
  expect(found.filter((match) => match.type === "record")).toHaveLength(RECORDS_PER_KIND + 1);
  expect(found.at(-1)).toMatchObject({
    type: "more",
    label: "Nog 3 in Verhaal › Mediabibliotheek: typ verder om te verfijnen",
  });
});
