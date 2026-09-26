// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TripMap } from "./TripMap";

afterEach(cleanup);

it("keeps the route and stop controls usable when WebGL is unavailable", () => {
  render(<TripMap owner points={[{ id: "city", label: "Area city", coordinates: [121, 25] }]} lines={[{ id: "route", label: "Area route", coordinates: [[121, 25], [122, 26]] }]} />);
  expect(screen.getByText("Interactieve kaart niet beschikbaar. Gebruik de route in woorden en de puntknoppen.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Area city" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Area route" })).toBeTruthy();
  const words = screen.getByRole("heading", { name: "Route in woorden" }).parentElement!;
  expect(within(words).getByRole("button", { name: "Area route" })).toBeTruthy();
  expect(within(words).queryByText("Area city")).toBeNull();
  expect((screen.getByRole("button", { name: "3D-terrein" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Satelliet" }) as HTMLButtonElement).disabled).toBe(true);
});

it("offers the same non-sensitive map-layer controls to visitors", () => {
  render(<TripMap points={[{ id: "city", label: "Area city", coordinates: [121, 25] }]} lines={[]} />);
  expect(screen.getByRole("button", { name: "3D-terrein" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Satelliet" })).toBeTruthy();
});
