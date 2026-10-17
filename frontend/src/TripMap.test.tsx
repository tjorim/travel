// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { areaFocusPoints, TripMap } from "./TripMap";

afterEach(cleanup);

it("keeps the route and stop controls usable when WebGL is unavailable", () => {
  render(
    <TripMap
      owner
      points={[{ id: "city", label: "Area city", coordinates: [121, 25] }]}
      lines={[
        {
          id: "route",
          label: "Area route",
          coordinates: [
            [121, 25],
            [122, 26],
          ],
        },
      ]}
    />,
  );
  expect(
    screen.getByText(
      "Interactieve kaart niet beschikbaar. Gebruik de route in woorden en de puntknoppen.",
    ),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Area city" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Area route" })).toBeTruthy();
  const words = screen.getByRole("heading", { name: "Route in woorden" }).parentElement!;
  expect(within(words).getByRole("button", { name: "Area route" })).toBeTruthy();
  expect(within(words).queryByText("Area city")).toBeNull();
  expect((screen.getByRole("button", { name: "3D-terrein" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole("button", { name: "Satelliet" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole("button", { name: "Wereldbol" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

it("offers the same non-sensitive map-layer controls to visitors", () => {
  render(
    <TripMap points={[{ id: "city", label: "Area city", coordinates: [121, 25] }]} lines={[]} />,
  );
  expect(screen.getByRole("button", { name: "3D-terrein" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Satelliet" })).toBeTruthy();
});

it("frames only the locations filed under the focused area", () => {
  const area = {
    id: "a",
    label: "Area",
    coordinates: [121, 25] as [number, number],
    kind: "area" as const,
  };
  const nearby = {
    id: "l1",
    label: "Nearby",
    coordinates: [121.2, 25.1] as [number, number],
    kind: "location" as const,
    areaId: "a",
  };
  const far = {
    id: "l2",
    label: "Other area",
    coordinates: [130, 35] as [number, number],
    kind: "location" as const,
    areaId: "b",
  };
  expect(areaFocusPoints(area, [area, nearby, far])).toEqual([area, nearby]);
});

it("keeps point and route cards synchronized with the textual controls and reset", () => {
  render(
    <TripMap
      points={[
        {
          id: "city",
          label: "Lisbon",
          coordinates: [-9, 38],
          dates: "september 2054",
          links: [{ label: "Bezoek bekijken", href: "#visit-1" }],
        },
      ]}
      lines={[
        {
          id: "leg",
          label: "Lisbon–Coimbra",
          coordinates: [
            [-9, 38],
            [-8, 40],
          ],
          from: "Lisbon",
          to: "Coimbra",
          transport: "train",
          dates: "27 september 2054",
          links: [{ label: "Route bekijken", href: "#route-1" }],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Lisbon" }));
  expect(screen.getByText("september 2054")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Bezoek bekijken" }).getAttribute("href")).toBe(
    "#visit-1",
  );
  expect(screen.getByRole("button", { name: "Lisbon" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: /Lisbon–Coimbra/ }));
  expect(screen.getByText("Trein")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Route bekijken" }).getAttribute("href")).toBe(
    "#route-1",
  );
  expect(screen.getByRole("button", { name: "Lisbon" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Hele reis tonen" }));
  expect(screen.queryByRole("link", { name: "Route bekijken" })).toBeNull();
  expect(screen.getByRole("button", { name: /Lisbon–Coimbra/ }).getAttribute("aria-pressed")).toBe(
    "false",
  );
});
