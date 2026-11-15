// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { changeLocale } from "../locale";
import { server } from "../mocks/server";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Trip } from "../api-types";
import { TripEditor } from "./TripEditor";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip = (overrides: Partial<Trip> = {}): Trip => ({
  owner_subject: "owner-1",
  content_language: "nl",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Rondreis Taiwan",
  title_nl: "Rondreis Taiwan",
  title_en: null,
  summary: null,
  summary_nl: null,
  summary_en: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
  ...overrides,
});

beforeEach(() => {
  auth.session = { accessToken: testToken() };
});
afterEach(() => {
  cleanup();
  act(() => changeLocale("nl"));
});

function renderEditor(saved: Trip | null, onSaved = vi.fn()) {
  server.use(http.get("/api/trips", () => HttpResponse.json([])));
  renderWithOwner(
    <TripEditor
      trip={saved}
      open
      onClose={() => undefined}
      onSaved={onSaved}
      onDeleted={() => undefined}
      onNotice={() => undefined}
    />,
  );
  return onSaved;
}

it("creates a trip in the language the owner uses the app in, with both title versions", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.post("/api/trips", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(trip({ id: "new", content_language: "en", title_en: "Japan" }), {
        status: 201,
      });
    }),
  );
  act(() => changeLocale("en"));
  renderEditor(null);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Japan" } });
  fireEvent.click(screen.getByRole("button", { name: "Create trip" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({
    title_nl: null,
    title_en: "Japan",
    summary_nl: null,
    summary_en: null,
    starts_on: null,
    ends_on: null,
    content_language: "en",
  });
});

it("saves both language versions of an existing trip's title and summary", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/trips/trip", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(trip());
    }),
  );
  renderEditor(trip());
  const group = within(screen.getByRole("radiogroup", { name: "Taal van Titel" }));
  fireEvent.click(group.getByRole("radio", { name: /^Engels/ }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Taiwan tour" } });
  fireEvent.click(screen.getByRole("button", { name: "Reis opslaan" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ title_nl: "Rondreis Taiwan", title_en: "Taiwan tour" });
  expect(bodies[0]).not.toHaveProperty("content_language");
});

it("changes the content language alone, without touching any text", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/trips/trip", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(trip({ content_language: "en" }));
    }),
  );
  const onSaved = renderEditor(trip());
  const language = within(screen.getByRole("radiogroup", { name: "Taal van de reis" }));
  expect(language.getByRole("radio", { name: "Nederlands" }).getAttribute("aria-checked")).toBe(
    "true",
  );
  fireEvent.click(language.getByRole("radio", { name: "Engels" }));
  fireEvent.click(screen.getByRole("button", { name: "Taal wijzigen" }));
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({ content_language: "en" });
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
});

it("warns before moving every text to the other language, and sends move_texts only then", async () => {
  const bodies: unknown[] = [];
  server.use(
    http.patch("/api/trips/trip", async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json(
        trip({ content_language: "en", title_nl: null, title_en: "Rondreis Taiwan" }),
      );
    }),
  );
  renderEditor(trip());
  const language = within(screen.getByRole("radiogroup", { name: "Taal van de reis" }));
  fireEvent.click(language.getByRole("radio", { name: "Engels" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Verplaats ook de teksten van de reis/ }));
  fireEvent.click(screen.getByRole("button", { name: "Taal wijzigen" }));

  // Nothing is sent until the owner has read the warning and confirmed.
  const warning = await screen.findByRole("alertdialog", {
    name: "Alle teksten naar het Engels verplaatsen?",
  });
  expect(bodies).toEqual([]);
  expect(warning.textContent).toContain("Dit wordt meteen opgeslagen");
  fireEvent.click(within(warning).getByRole("button", { name: "Annuleren" }));
  expect(bodies).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Taal wijzigen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Naar het Engels verplaatsen",
    }),
  );
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({ content_language: "en", move_texts: true });
  // The editor shows the moved texts instead of the stale ones.
  const titles = within(screen.getByRole("radiogroup", { name: "Taal van Titel" }));
  await waitFor(() =>
    expect(titles.getByRole("radio", { name: /^Nederlands/ }).getAttribute("aria-label")).toBe(
      "Nederlands (hoofdtaal, leeg)",
    ),
  );
  fireEvent.click(titles.getByRole("radio", { name: /^Engels/ }));
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Rondreis Taiwan");
  expect(screen.getByLabelText("Titel").getAttribute("lang")).toBe("en");
});

it("explains a refused move, and holds the language change while the details are unsaved", async () => {
  server.use(
    http.patch("/api/trips/trip", () =>
      HttpResponse.json(
        {
          detail: "x",
          errors: [{ code: "trip_text_in_both_languages", params: { field: "title" }, path: [] }],
        },
        { status: 422 },
      ),
    ),
  );
  renderEditor(trip());
  const language = within(screen.getByRole("radiogroup", { name: "Taal van de reis" }));
  fireEvent.click(language.getByRole("radio", { name: "Engels" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Verplaats ook de teksten van de reis/ }));
  fireEvent.click(screen.getByRole("button", { name: "Taal wijzigen" }));
  fireEvent.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", {
      name: "Naar het Engels verplaatsen",
    }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("beide talen");

  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuwe titel" } });
  expect(
    (screen.getByRole("button", { name: "Taal wijzigen" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText("Sla je wijzigingen aan de reis eerst op of verwerp ze.")).toBeTruthy();
});
