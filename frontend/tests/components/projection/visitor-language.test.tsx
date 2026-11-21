import type * as Api from "@/api-schema";
import { jsonResponse } from "@/mocks/response";
// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { stubViewport } from "@/mocks/viewport";
import { changeLocale, selectedLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { serveApi } from "../../utils/serve-api";
import { fixture } from "../../utils/test-projection";
import type { Projection } from "@/components/projection/ProjectionView";
import { VisitorRoutes } from "@/features/visitor/visitor-routes";

const token = "fictional-capability-for-language-tests";

/** A delivered document: Dutch title and update, and an English-only visit title that falls back, marked. */
function document(language: "nl" | "en"): Projection {
  const dutch = language === "nl";
  return fixture<Projection>({
    schema_version: "travel/unlisted-trip@1",
    numbers: { days: 1, areas: 1, countries: 1, nights: 0 },
    title: dutch ? "Rondreis Taiwan" : "Taiwan tour",
    summary: dutch ? "Een **korte** reis" : "A **short** trip",
    summary_html: dutch
      ? "<p>Een <strong>korte</strong> reis</p>"
      : "<p>A <strong>short</strong> trip</p>",
    dates: null,
    visits: [
      {
        id: "visit",
        title: "Museum",
        // Only English exists: in Dutch it is delivered as the other language, and marked.
        ...(dutch ? { title_lang: "en" } : {}),
        place: { label: dutch ? "Taipei" : "Taipei City", label_lang: undefined },
        starts_on: "2054-04-02",
        date_precision: "day",
      },
    ],
    places: [],
    stays: [],
    navigation: [],
    updates: [
      {
        id: "story",
        title: dutch ? "Eerste dag" : "First day",
        body: dutch ? "Het regende." : "It rained.",
        body_html: dutch ? "<p>Het regende.</p>" : "<p>It rained.</p>",
        story_date: "2054-04-02",
        date_precision: "day",
      },
    ],
    routes: [],
    media: [
      {
        id: "photo",
        image: { id: "photo" },
        alt_text: dutch ? "Een tempel" : "A temple",
        caption: dutch ? "Bij zonsopgang" : "At sunrise",
      },
    ],
  });
}

/** Serves the trip in the language asked for; with none it is the trip's own (Dutch) and the response says so. */
function serve() {
  const calls: string[] = [];
  serveApi(
    vi.fn(async (url: string) => {
      calls.push(url);
      if (!url.startsWith(`/api/shared/${token}`)) return jsonResponse<never[]>([]);
      const asked = new URL(url, "http://localhost").searchParams.get("lang");
      const language = asked === "en" ? "en" : "nl";
      return jsonResponse<Api.ProjectionDocument>(document(language), {
        headers: { "Content-Language": language },
      });
    }),
  );
  return calls;
}

beforeEach(() => stubViewport(true));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  act(() => changeLocale("nl"));
  localStorage.clear();
});

it("asks for the trip's own language when the visitor chose none, and reads the interface in it", async () => {
  const calls = serve();
  // The visitor's browser would otherwise show this page in English, and the translation runtime may well have
  // written that default to storage: it is still no choice of theirs.
  act(() => changeLocale("en"));
  localStorage.clear();
  localStorage.setItem("travel-locale", "en");
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByRole("heading", { name: "Rondreis Taiwan" });
  expect(calls[0]).toBe(`/api/shared/${token}`);
  await waitFor(() => expect(selectedLocale()).toBe("nl"));
  expect(window.document.documentElement.lang).toBe("nl");
  // Taking the trip's language is not a choice of the visitor: nothing is remembered as one.
  expect(localStorage.getItem("travel-locale-choice")).toBeNull();
});

it("marks authored text with the language it is delivered in, whatever the interface says", async () => {
  serve();
  const view = render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  const title = await screen.findByRole("heading", { name: "Rondreis Taiwan" });
  expect(title.getAttribute("lang")).toBe("nl");
  expect(screen.getByText("Eerste dag").getAttribute("lang")).toBe("nl");
  expect(screen.getByText("Het regende.").closest("[lang]")?.getAttribute("lang")).toBe("nl");
  expect(
    view.container.querySelector(".markdown strong")?.closest("[lang]")?.getAttribute("lang"),
  ).toBe("nl");
  // A text delivered in the other language says so, and the page leaves it as delivered.
  expect(screen.getAllByText("Museum")[0]?.getAttribute("lang")).toBe("en");
  expect(screen.getByRole("img", { name: "Een tempel" }).getAttribute("lang")).toBe("nl");
  // The interface chrome around it carries no authored `lang` of its own.
  expect(
    screen.getByRole("heading", { name: m.visitor_updates() }).getAttribute("lang"),
  ).toBeNull();
});

it("asks again in the language the visitor chooses and shows what the server delivers", async () => {
  const calls = serve();
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByRole("heading", { name: "Rondreis Taiwan" });
  act(() => changeLocale("en"));
  // The page stays up while the other language's texts are fetched, then shows them.
  expect(screen.getByRole("heading", { name: "Rondreis Taiwan" })).toBeTruthy();
  const english = await screen.findByRole("heading", { name: "Taiwan tour" });
  expect(calls.at(-1)).toBe(`/api/shared/${token}?lang=en`);
  expect(english.getAttribute("lang")).toBe("en");
  expect(screen.getByText("First day").getAttribute("lang")).toBe("en");
  expect(screen.getAllByText("Museum")[0]?.hasAttribute("lang")).toBe(true);
  expect(screen.getAllByText("Museum")[0]?.getAttribute("lang")).toBe("en");
  expect(screen.queryByText("Rondreis Taiwan")).toBeNull();
  // The choice is the visitor's own now: it is remembered and asked for from then on.
  expect(localStorage.getItem("travel-locale-choice")).toBe("en");
  cleanup();
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByRole("heading", { name: "Taiwan tour" });
  expect(calls.at(-1)).toBe(`/api/shared/${token}?lang=en`);
});

it("asks the public index for the interface language, and marks each card's text", async () => {
  const calls: string[] = [];
  serveApi(
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith("/api/public/trips"))
        return jsonResponse<Api.PublicTripCard[]>([
          {
            summary_text: null,
            slug: "taiwan",
            title: "Taiwan tour",
            title_lang: "en",
            summary: "Een korte reis",
            dates: null,
            cover: null,
          },
        ]);
      return jsonResponse<never[]>([]);
    }),
  );
  render(<VisitorRoutes initialEntries={["/trips"]} />);
  const card = await screen.findByRole("heading", { name: "Taiwan tour" });
  expect(calls[0]).toBe("/api/public/trips?lang=nl");
  // A title in the other language is marked; the summary is in the language that was asked for.
  expect(card.getAttribute("lang")).toBe("en");
  expect(screen.getByText("Een korte reis").getAttribute("lang")).toBe("nl");
  act(() => changeLocale("en"));
  await waitFor(() => expect(calls.at(-1)).toBe("/api/public/trips?lang=en"));
});
