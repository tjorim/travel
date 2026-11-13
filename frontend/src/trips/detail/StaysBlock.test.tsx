// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { Stay, Trip } from "../../api-types";
import { StaysBlock } from "./StaysBlock";

vi.mock("./shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shared")>()),
  RecordHeading: ({ children }: { children: React.ReactNode }) => <h4>{children}</h4>,
}));

afterEach(cleanup);

const trip = { id: "trip" } as Trip;
const stay = (fields: Partial<Stay>) =>
  ({
    id: "s1",
    status: "planned",
    property_name: null,
    check_in_date: "2054-11-16",
    check_out_date: "2054-11-18",
    check_in_time: null,
    check_out_time: null,
    website_url: null,
    booking_reference: null,
    contact_details: null,
    notes: null,
    location: null,
    area: { id: "a", label: "Alishan", timezone: null },
    visibility: "private",
    ...fields,
  }) as Stay;

it("describes a stay without an accommodation by its area", () => {
  render(<StaysBlock trip={trip} stays={[stay({})]} />);
  expect(screen.getByText("Nog te kiezen in Alishan")).toBeTruthy();
  expect(screen.getByText("Accommodatie nog niet gekozen · Alishan")).toBeTruthy();
});
