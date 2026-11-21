import { responseFixtures } from "@/mocks/response-test-fixtures";
import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { server } from "@/mocks/server";
import { renderWithOwner, testToken } from "../../../utils/query-test-utils";
import { PlaceSearchField } from "@/features/trips/records/PlaceSearchField";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("@/app/providers/auth-context", () => ({ useAuth: () => auth }));

afterEach(cleanup);

it("shows a result's local name beside its name and passes on the suggested names apart from the location", async () => {
  auth.session = { accessToken: testToken() };
  server.use(
    http.post("/api/trips/trip/places/search", () =>
      HttpResponse.json<Api.PlaceSearchResponse>({
        provider: "synthetic",
        attribution: "Synthetic",
        attribution_url: "https://example.test",
        results: [
          {
            ...responseFixtures.PlaceSearchResult,
            osm_element_type: "node",
            osm_element_id: "1",
            display_name: "Senso-ji, Tokyo, Japan",
            latitude: 35.7,
            longitude: 139.8,
            local_name: "浅草寺",
            name_nl: "Sensō-ji",
            name_en: "Senso-ji",
          },
        ],
      }),
    ),
  );
  const onSelect = vi.fn();
  renderWithOwner(
    <PlaceSearchField
      tripId="trip"
      legend="Place"
      inputLabel="Public place"
      placeholder=""
      help=""
      onSelect={onSelect}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Public place" }), {
    target: { value: "Senso-ji" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Zoeken" }));
  const result = await screen.findByRole("button", { name: /^Senso-ji, Tokyo, Japan/ });
  // The local name sits beside the translated one; its language is unknown, so it claims none.
  const local = within(result).getByText("浅草寺");
  expect(local.getAttribute("lang")).toBe("");
  expect(local.getAttribute("dir")).toBe("auto");
  fireEvent.click(result);
  const [location, existing, names] = onSelect.mock.calls[0];
  expect(location).toMatchObject({ osm_element_id: "1", local_name: "浅草寺" });
  expect(location).not.toHaveProperty("name_nl");
  expect(existing).toBeUndefined();
  expect(names).toEqual({ nl: "Sensō-ji", en: "Senso-ji" });
});
