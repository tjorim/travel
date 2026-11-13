import { expect, it } from "vitest";

import type { AlternativeGroup, Stay } from "../../api-types";
import { comparisonRows, groupedIds, groupTitle, membersOf, spanLabel } from "./model";

const area = { id: "a1", label: "Tainan" } as Stay["area"];
const stay = (id: string, fields: Partial<Stay> = {}) =>
  ({
    id,
    status: "idea",
    check_in_date: "2054-04-01",
    check_out_date: "2054-04-04",
    property_name: id,
    website_url: null,
    notes: null,
    location: null,
    area,
    ...fields,
  }) as Stay;
const group = (members: Stay[], label: string | null = null): AlternativeGroup => ({
  id: "g",
  kind: "stay",
  label,
  chosen_id: null,
  members: members.map((item) => ({
    record_id: item.id,
    chosen: false,
    stay: item,
    visit: null,
    route: null,
  })),
  created_at: "",
  updated_at: "",
});

it("names an unnamed group by the days its members cover and prefers the owner's label", () => {
  const members = [
    stay("A"),
    stay("B", { check_in_date: "2054-04-02", check_out_date: "2054-04-06" }),
  ];
  expect(groupTitle(group(members))).toBe("Alternatieven · 1 apr → 6 apr");
  expect(groupTitle(group(members, "Waar slapen"))).toBe("Waar slapen");
  expect(spanLabel("stay", [stay("A")])).toBe("1 apr → 4 apr");
  expect(groupedIds([group(members)])).toEqual(new Set(["A", "B"]));
  expect(membersOf(group(members)).map((member) => member.id)).toEqual(["A", "B"]);
});

it("compares stays side by side with the exact location and notes the owner saved", () => {
  const rows = comparisonRows("stay", [
    stay("A", { notes: "Quiet", website_url: "https://hotel.example.test" }),
    stay("B"),
  ]);
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row.values]));
  expect(byLabel["Naam"]).toEqual(["A", "B"]);
  expect(byLabel["Nachten"]).toEqual(["3", "3"]);
  expect(byLabel["Notities"]).toEqual(["Quiet", "—"]);
  expect(byLabel["Website"]).toEqual(["https://hotel.example.test", "—"]);
  expect(byLabel["Exacte locatie (alleen jij)"]).toHaveLength(2);
});
