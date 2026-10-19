import { expect, it } from "vitest";

import type { Area, MediaAsset, Route, TripTask } from "../tracker-model";
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
    "Plan › Routes › Naar Taipei",
    "Voorbereiden › Nog te regelen › Taipei visum",
  ]);
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
