import type { StyleSpecification } from "maplibre-gl";
import { expect, it } from "vitest";

import { styleLabelFont } from "./map-style";

const symbol = (id: string, font?: unknown) =>
  ({
    id,
    type: "symbol",
    source: "s",
    layout: font ? { "text-font": font } : {},
  }) as StyleSpecification["layers"][number];

it("takes the plain-weight font stack the style itself labels with", () => {
  expect(
    styleLabelFont({ layers: [symbol("water", ["Noto Sans Italic"]), symbol("roads", ["Noto Sans Regular"])] }),
  ).toEqual(["Noto Sans Regular"]);
});

it("falls back to a styled stack, then to Noto Sans, so MapLibre's default font is never requested", () => {
  expect(styleLabelFont({ layers: [symbol("cities", ["Noto Sans Bold"])] })).toEqual(["Noto Sans Bold"]);
  expect(styleLabelFont({ layers: [symbol("bare"), symbol("expression", ["literal", ["Open Sans"]])] })).toEqual([
    "Noto Sans Regular",
  ]);
  expect(styleLabelFont(undefined)).toEqual(["Noto Sans Regular"]);
});
