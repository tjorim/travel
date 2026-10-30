// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { server } from "../mocks/server";
import { changeLocale } from "../locale";
import { renderWithOwner, testToken } from "../query/test-utils";
import { PlaceSearchField } from "./PlaceSearchField";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

afterEach(() => {
  cleanup();
  changeLocale("nl");
});

it.each([
  ["nl", 429, "Opnieuw zoeken", "Locaties zoeken is mislukt.", "Geen locaties gevonden."],
  ["en", 503, "Retry search", "Location search failed.", "No locations found."],
] as const)(
  "submits explicitly and retries a %s failure",
  async (locale, status, retry, failure, empty) => {
    changeLocale(locale);
    auth.session = { accessToken: testToken() };
    let calls = 0;
    server.use(
      http.post("/api/trips/trip/places/search", () => {
        calls++;
        return HttpResponse.json({ detail: "Private provider prose" }, { status });
      }),
    );
    const submit = vi.fn((event) => event.preventDefault());
    renderWithOwner(
      <form onSubmit={submit}>
        <input aria-label="Notes" defaultValue="Unsaved notes" />
        <PlaceSearchField
          tripId="trip"
          legend="Place"
          inputLabel="Public place"
          placeholder=""
          help=""
          onSelect={vi.fn()}
        />
      </form>,
    );
    const input = screen.getByRole("textbox", { name: "Public place" });
    input.focus();
    fireEvent.change(input, { target: { value: "Synthetic station" } });
    expect(calls).toBe(0);
    fireEvent.keyDown(input, { key: "Enter" });
    const retryButton = await screen.findByRole("button", { name: retry });
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByText("Private provider prose")).not.toBeInTheDocument();
    expect(input).toHaveValue("Synthetic station");
    expect(input).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(failure);
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    server.use(
      http.post("/api/trips/trip/places/search", () => {
        calls++;
        return HttpResponse.json({
          provider: "synthetic",
          attribution: "Synthetic",
          attribution_url: "https://example.test",
          results: [],
        });
      }),
    );
    fireEvent.click(retryButton);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: retry })).not.toBeInTheDocument(),
    );
    expect(calls).toBe(2);
    expect(await screen.findByText(empty)).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("Notes")).toHaveValue("Unsaved notes");
  },
);
