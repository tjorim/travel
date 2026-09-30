// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { TripEditor } from "./trips/TripEditor";
import { applyMarkdownSnippet } from "./forms/markdown-snippets";
import { renderWithOwner, testToken } from "./query/test-utils";
import { useFeedback, textNotice } from "./query/feedback";
import { m } from "./paraglide/messages.js";
import { bytesLabel, ROUTE_MODE_LABELS } from "./tracker-model";
import { VISIT_STATUS_LABELS } from "./trips/VisitManager";
import { completeSignIn } from "./auth";
import { mapMessages } from "./map-messages";

const auth = vi.hoisted(() => ({ session: { accessToken: "" } }));
vi.mock("./auth-context", () => ({ useAuth: () => auth }));
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  act(() => changeLocale("nl"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => changeLocale("nl"));
});
const props = { trip: null, open: true, onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn(), onNotice: vi.fn() };

it("rerenders client validation and dirty values without replacing focused controls", async () => {
  renderWithOwner(<TripEditor {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Reis maken" }));
  await screen.findByText("Geef de reis een titel.");
  const input = screen.getByRole("textbox", { name: "Titel" });
  input.focus();
  act(() => changeLocale("en"));
  expect(screen.getByText("Give the trip a title.")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Title" })).toBe(input);
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: "Mijn eigen titel" } });
  const source = screen.getByRole("textbox", { name: "Summary (optional)" }) as HTMLTextAreaElement;
  fireEvent.change(source, { target: { value: "**Mijn eigen verhaal**" } });
  fireEvent.click(screen.getByRole("button", { name: "Close New trip" }));
  await screen.findByRole("alertdialog", { name: "Discard changes?" });
  act(() => changeLocale("nl"));
  expect(screen.getByRole("alertdialog", { name: "Wijzigingen verwerpen?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verder bewerken" }));
  expect((input as HTMLInputElement).value).toBe("Mijn eigen titel");
  expect(source.value).toBe("**Mijn eigen verhaal**");
});

it("keeps a pending save and submitted authored values across switches", async () => {
  let finish!: (response: Response) => void;
  const request = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", request);
  renderWithOwner(<TripEditor {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Titel" }), { target: { value: "Eigen reis" } });
  fireEvent.click(screen.getByRole("button", { name: "Reis maken" }));
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  act(() => changeLocale("en"));
  expect((screen.getByRole("button", { name: "Creating trip…" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Eigen reis");
  expect(JSON.parse(String((request.mock.calls[0] as unknown as [string, RequestInit])[1].body)).title).toBe(
    "Eigen reis",
  );
  await act(async () => finish(new Response(JSON.stringify({ id: "new", title: "Eigen reis", travel_updates: [] }))));
});

it("renders retained success notices, enums and plural messages in the current locale", () => {
  function Notice() {
    const [notice] = useFeedback<string>(textNotice(m.owner_trip_saved));
    return <p>{notice}</p>;
  }
  renderWithOwner(<Notice />);
  expect(screen.getByText("Reis opgeslagen.")).toBeTruthy();
  for (const locale of ["en", "nl"] as const) {
    act(() => changeLocale(locale));
    expect(screen.getByText(locale === "en" ? "Trip saved." : "Reis opgeslagen.")).toBeTruthy();
    expect(ROUTE_MODE_LABELS.flight).toBe(locale === "en" ? "Flight" : "Vlucht");
    expect(bytesLabel(1536)).toBe(locale === "en" ? "1.5 kB" : "1,5 kB");
    expect(VISIT_STATUS_LABELS.planned).toBe(locale === "en" ? "Planned" : "Gepland");
    expect(mapMessages()["NavigationControl.ZoomIn"]).toBe(locale === "en" ? "Zoom in" : "Inzoomen");
    for (const count of [0, 1, 3]) {
      expect(m.owner_night_count({ count })).toBe(
        `${count} ${locale === "en" ? (count === 1 ? "night" : "nights") : count === 1 ? "nacht" : "nachten"}`,
      );
      expect(m.owner_reminder_count({ count })).toContain(String(count));
      expect(m.owner_missing_nights({ count })).toContain(String(count));
    }
  }
});

it("localizes only new Markdown placeholders and preserves existing source and selections", () => {
  const dutch = applyMarkdownSnippet("", 0, 0, "bold").value;
  expect(dutch).toBe("**vet**");
  act(() => changeLocale("en"));
  expect(applyMarkdownSnippet(dutch, dutch.length, dutch.length, "italic").value).toBe("**vet***italic*");
  expect(applyMarkdownSnippet("Eigen tekst", 0, 5, "bold").value).toBe("**Eigen** tekst");
  expect(applyMarkdownSnippet("", 0, 0, "link").value).toBe("[link text](https://)");
});

it("keeps an authentication failure localizable after the callback has rejected", async () => {
  sessionStorage.removeItem("travel-tracker-pkce-transaction");
  const failure = await completeSignIn("").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe("De aanmeldsessie ontbreekt of is verlopen.");
  act(() => changeLocale("en"));
  expect((failure as Error).message).toBe("The sign-in session is missing or has expired.");
});
