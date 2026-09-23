// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TripMap } from "./TripMap";

afterEach(cleanup);

it("keeps the route and stop controls usable when WebGL is unavailable", () => {
  render(<TripMap owner points={[{ id: "city", label: "Broad city", coordinates: [121, 25] }]} lines={[{ id: "route", label: "Broad route", coordinates: [[121, 25], [122, 26]] }]} />);
  expect(screen.getByText("Interactieve kaart niet beschikbaar. Gebruik de route in woorden en de halteknoppen.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Broad city" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Broad route" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "3D-terrein" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Satelliet" }) as HTMLButtonElement).disabled).toBe(true);
});
