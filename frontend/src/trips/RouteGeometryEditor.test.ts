import { expect, it } from "vitest";
import { insertionIndex } from "./RouteGeometryEditor";

const line = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

it("adds a point to the end of a line shorter than two points", () => {
  expect(insertionIndex([], { x: 5, y: 5 })).toBe(0);
  expect(insertionIndex([{ x: 0, y: 0 }], { x: 5, y: 5 })).toBe(1);
});

it("inserts after the start of the nearest segment", () => {
  expect(insertionIndex(line, { x: 50, y: 10 })).toBe(1);
  expect(insertionIndex(line, { x: 90, y: 60 })).toBe(2);
});

it("tolerates repeated vertices", () => {
  expect(
    insertionIndex(
      [
        { x: 10, y: 10 },
        { x: 10, y: 10 },
        { x: 50, y: 10 },
      ],
      { x: 40, y: 12 },
    ),
  ).toBe(2);
});
