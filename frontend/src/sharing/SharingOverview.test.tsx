// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { changeLocale } from "../locale";
import { renderWithOwner, testToken } from "../query/test-utils";
import { serveApi } from "../query/serve-api";
import { SharingOverview } from "./SharingOverview";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const scope = (title = true) => ({
  schema_version: "travel/share-scope@1",
  trip: { title, summary: false, dates: null },
  items: [],
});
const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
const trips = [
  {
    id: "t1",
    title: "Alpha Coast",
    summary: null,
    starts_on: null,
    ends_on: null,
    travel_updates: [],
  },
  {
    id: "t2",
    title: "Beta Hills",
    summary: null,
    starts_on: null,
    ends_on: null,
    travel_updates: [],
  },
];
const link = (state: string) => ({
  revision: 1,
  id: "l1",
  series_id: "l1",
  label: "Family",
  state,
  scope: scope(),
  token: "synthetic-link-token-0000000000000000000",
  expires_at: soon,
  created_at: "2054-01-01T00:00:00Z",
  activated_at: "2054-01-02T00:00:00Z",
  revoked_at: null,
});
const collection = {
  id: "c1",
  label: "Relatives",
  title: null,
  state: "active",
  token: "synthetic-collection-token-000000000000",
  expires_at: null,
  rotations: 0,
  created_at: "2054-01-01T00:00:00Z",
  updated_at: "2054-01-01T00:00:00Z",
  activated_at: "2054-01-02T00:00:00Z",
  revoked_at: null,
  members: [
    {
      revision: 1,
      id: "m1",
      trip_id: "t1",
      trip_title: "Alpha Coast",
      scope: scope(),
      delivered_records: 0,
      created_at: "2054-01-01T00:00:00Z",
      updated_at: "2054-01-01T00:00:00Z",
    },
  ],
};
let calls: string[];

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  calls = [];
  serveApi((url, init) => {
    calls.push(`${init.method} ${url}`);
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (url === "/api/trips") return json(trips);
    if (url === "/api/trips/t1/public-projection")
      return json({
        revision: 1,
        trip_id: "t1",
        scope: scope(),
        surface_state: "published",
        slug: "alpha",
      });
    if (url === "/api/trips/t2/public-projection")
      return json({
        revision: 1,
        trip_id: "t2",
        scope: scope(),
        surface_state: "unpublished",
        slug: "beta",
      });
    if (url === "/api/trips/t1/share-links") return json([link("active")]);
    if (url === "/api/trips/t2/share-links") return json([]);
    if (url === "/api/collections") return json([collection]);
    if (url === "/api/collections/c1/revoke" && init.method === "POST")
      return json({ ...collection, state: "revoked", token: null });
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  changeLocale("nl");
});

it("lists public trips, hidden links and collections with their warnings", async () => {
  changeLocale("en");
  renderWithOwner(<SharingOverview />);
  expect(await screen.findByRole("heading", { name: "Public trips" })).toBeTruthy();
  const publicList = screen.getByRole("region", { name: "Public trips" });
  expect(within(publicList).getByText("Alpha Coast")).toBeTruthy();
  // The unpublished trip is not listed as public.
  expect(within(publicList).queryByText("Beta Hills")).toBeNull();
  expect(screen.getByRole("listitem", { name: "Family (Alpha Coast)" })).toBeTruthy();
  const row = screen.getByRole("listitem", { name: "Relatives" });
  expect(within(row).getByText(/Alpha Coast/)).toBeTruthy();
  expect(within(row).getByText(/Shares no records|Shows: title/)).toBeTruthy();
  const warnings = screen.getByRole("region", { name: "Needs attention" });
  expect(within(warnings).getByText(/Family \(Alpha Coast\) expires on/)).toBeTruthy();
  expect(
    within(warnings).getByText(
      "Alpha Coast in Relatives shares no records: visitors see an empty page.",
    ),
  ).toBeTruthy();
});

it("revokes a collection only after confirmation and shows it in Dutch", async () => {
  renderWithOwner(<SharingOverview />);
  await screen.findByRole("heading", { name: "Verzamellinks" });
  fireEvent.click(screen.getByRole("button", { name: "Relatives intrekken" }));
  expect(calls.some((call) => call.includes("/revoke"))).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "Link intrekken" }));
  await waitFor(() => expect(calls).toContain("POST /api/collections/c1/revoke"));
});

it("says so when nothing is shared", async () => {
  changeLocale("en");
  serveApi((url) => {
    if (url === "/api/trips") return new Response("[]");
    if (url === "/api/collections") return new Response("[]");
    return undefined;
  });
  renderWithOwner(<SharingOverview />);
  expect(await screen.findByText("Nothing is shared yet")).toBeTruthy();
});
