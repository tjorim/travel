// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { ProjectionView, tripDates, type Projection } from "./ProjectionView";
import { VisitorRoutes } from "./visitor-routes";
import { RenderedPreview } from "./trips/RenderedPreview";
import { m } from "./paraglide/messages.js";
import { rememberSharedTrip } from "./saved-shared-trips";
import { http, HttpResponse } from "msw/http";
import { server } from "./mocks/server";
import { serveApi } from "./query/serve-api";

const token = "fictional-capability-for-locale-tests";
function projection(): Projection {
  return {
    schema_version: "travel/unlisted-trip@1",
    title: "Authored reis",
    summary: "**Authored** tekst",
    summary_html: "<p><strong>Authored</strong> tekst</p>",
    dates: { id: "dates", starts_on: "2054-04", ends_on: "2054-05", date_precision: "month" },
    visits: [
      {
        id: "visit",
        title: "Mijn bezoek",
        place: { latitude: 25, longitude: 121 },
        starts_on: "2054-04-02",
        date_precision: "day",
      },
    ],
    places: [{ id: "place", label: "Mijn plek", latitude: 25, longitude: 121 }],
    stays: [],
    navigation: [{ id: "place" }],
    updates: [
      { id: "stable-story", title: "Mijn verhaal", story_date: "2054", date_precision: "year" },
    ],
    routes: [
      {
        id: "route",
        mode: "train",
        status: "confirmed",
        departs_at: "2054-04-02T23:30:00Z",
        departure_timezone: "Asia/Taipei",
        departure: { label: "Mijn vertrek" },
      },
    ],
    media: [
      { id: "image", image: { id: "image" }, alt_text: "Mijn foto", caption: "Mijn onderschrift" },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  act(() => changeLocale("nl"));
});

it("switches projection chrome, dates and map alternatives while keeping authored content, URLs and anchors", () => {
  const view = render(
    <ProjectionView projection={projection()} audience="share" identifier={token} />,
  );
  expect(screen.getByText("april 2054 – mei 2054")).toBeTruthy();
  const img = screen.getByRole("img", { name: "Mijn foto" });
  const url = img.getAttribute("src");
  const story = view.container.querySelector("#stable-story");
  fireEvent.click(screen.getByRole("button", { name: "Mijn plek" }));
  act(() => changeLocale("en"));
  expect(screen.getByText("April 2054 – May 2054")).toBeTruthy();
  expect(screen.getByText("2 April 2054")).toBeTruthy();
  expect(screen.getByText(/3 Apr 2054, 07:30/)).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Updates in this story" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Visit: Mijn bezoek" }).getAttribute("href")).toBe(
    "#visit-visit",
  );
  expect(screen.getByRole("link", { name: "Directions" }).getAttribute("href")).toBe(
    `/api/shared/${token}/navigation/place`,
  );
  expect(screen.getByRole("heading", { name: "Train" })).toBeTruthy();
  expect(screen.getByText(/Confirmed/)).toBeTruthy();
  expect(screen.getByRole("img", { name: "Mijn foto" })).toBe(img);
  expect(img.getAttribute("src")).toBe(url);
  expect(view.container.querySelector("#stable-story")).toBe(story);
  expect(view.container.querySelector(".markdown strong")?.textContent).toBe("Authored");
});

it("preserves delivered date precision and rejects invalid dates in both languages", () => {
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    expect(tripDates({ id: "d", starts_on: "2054", date_precision: "year" })).toBe("2054");
    expect(tripDates({ id: "d", starts_on: "2054-02-30", date_precision: "day" })).toBeNull();
    expect(tripDates({ id: "d", starts_on: "2054-04-02", date_precision: "month" })).toBeNull();
    for (const count of [0, 1, 3]) expect(m.saved_trip_count({ count })).toContain(String(count));
  }
});

it("keeps an open lightbox and its focus through switching and returns focus on Escape", async () => {
  const data = projection();
  data.places = [];
  data.routes = [];
  render(<ProjectionView projection={data} audience="share" identifier={token} />);
  const trigger = screen.getByRole("button", { name: "Afbeelding openen: Mijn foto" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "Mijn foto" });
  const close = within(dialog).getByRole("button", { name: "Afbeelding sluiten" });
  close.focus();
  act(() => changeLocale("en"));
  expect(screen.getByRole("dialog", { name: "Mijn foto" })).toBe(dialog);
  expect(document.activeElement).toBe(close);
  expect(within(dialog).getByRole("button", { name: "Close image" })).toBe(close);
  expect(within(dialog).getByText("Mijn onderschrift")).toBeTruthy();
  fireEvent.keyDown(close, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});

it("retranslates retained image/video failures and retries only the selected image", () => {
  const data = projection();
  data.places = [];
  data.routes = [];
  data.media.push({ id: "video", video: { id: "video" } });
  const view = render(<ProjectionView projection={data} audience="share" identifier={token} />);
  fireEvent.error(screen.getByRole("img", { name: "Mijn foto" }));
  fireEvent.error(view.container.querySelector("source")!);
  act(() => changeLocale("en"));
  expect(screen.getByText("This video is unavailable.")).toBeTruthy();
  expect(screen.getByRole("button", { name: m.retry() })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: m.retry() }));
  expect(screen.getByRole("img", { name: "Mijn foto" }).getAttribute("src")).toBe(
    `/api/shared/${token}/files/image`,
  );
  expect(screen.queryByText("This image is unavailable.")).toBeNull();
});

it("reports denied saved-link storage without losing the trip or refetching on a locale switch", async () => {
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: () => {
      throw new Error("denied");
    },
  });
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL) => new Response(JSON.stringify(projection())),
  );
  serveApi(fetcher);
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByRole("heading", { name: "Authored reis" });
  expect(screen.getByText(m.visitor_storage_failed())).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText(m.visitor_storage_failed())).toBeTruthy();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/shared/${token}`);
});

it("sets a long authored trip title in a smaller, looser heading than a short one", async () => {
  const short = projection();
  const long = {
    ...projection(),
    title: "Een reis met een bijzonder lange titel die over meerdere regels moet lopen",
  };
  for (const [data, looser] of [
    [short, false],
    [long, true],
  ] as const) {
    serveApi(vi.fn(async () => new Response(JSON.stringify(data))));
    const view = render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
    const heading = await screen.findByRole("heading", { level: 1, name: data.title ?? "" });
    expect(heading.classList.contains("text-travel-title-long")).toBe(looser);
    view.unmount();
  }
});

it("uses the same translated projection in owner previews without visitor resource requests", async () => {
  act(() => changeLocale("en"));
  const data = projection();
  data.media = [];
  data.places = [];
  data.routes = [];
  const fetcher = vi.fn();
  serveApi(fetcher);
  render(
    <RenderedPreview
      projection={data}
      audience="share"
      tripId="private-trip"
      linkId="private-link"
      session={{ accessToken: "owner", expiresAt: Date.now() + 60000 }}
    />,
  );
  expect(screen.getByRole("navigation", { name: "Updates in this story" })).toBeTruthy();
  expect(screen.getByText("April 2054 – May 2054")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["/", "/trips/"])(
  "translates public cards at %s without changing slug paths",
  async (path) => {
    serveApi(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                slug: "authored-slug",
                title: "Mijn reis",
                summary: null,
                dates: projection().dates,
              },
            ]),
          ),
      ),
    );
    render(<VisitorRoutes initialEntries={[path]} />);
    const card = await screen.findByRole("link", { name: /Mijn reis/ });
    act(() => changeLocale("en"));
    expect(card.textContent).toContain("April 2054 – May 2054");
    expect(card.getAttribute("href")).toBe("/trips/authored-slug");
  },
);

it.each(["invalid", "revoked", "expired"])(
  "keeps an unavailable %s share ambiguous in both languages",
  async (reason) => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ detail: reason, errors: [{ code: reason }] }), {
          status: 404,
        }),
    );
    const sent = serveApi(fetcher);
    rememberSharedTrip(token, projection());
    render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
    await screen.findByRole("heading", { name: m.unavailable_trip() });
    act(() => changeLocale("en"));
    expect(screen.getByRole("heading", { name: m.unavailable_trip() })).toBeTruthy();
    expect(document.body.textContent).not.toContain(reason);
    expect(localStorage.getItem("travel-saved-shared-trips@1")).toBe("[]");
    expect(sent.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("retries a visitor network failure in the current locale", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(projection())));
  fetcher.mockRejectedValueOnce(new Error("private network diagnostic"));
  serveApi(fetcher);
  render(<VisitorRoutes initialEntries={[`/share/${token}`]} />);
  await screen.findByRole("button", { name: m.retry() });
  act(() => changeLocale("en"));
  expect(document.body.textContent).not.toContain("private network diagnostic");
  fireEvent.click(screen.getByRole("button", { name: m.retry() }));
  await screen.findByRole("heading", { name: "Authored reis" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps a saved shortcut visible when forgetting is denied and translates its retained failure", async () => {
  rememberSharedTrip(token, projection());
  vi.stubGlobal("localStorage", {
    getItem: localStorage.getItem.bind(localStorage),
    setItem: () => {
      throw new Error("denied");
    },
  });
  server.use(
    http.get("/api/public/trips", () => HttpResponse.json([])),
    http.get(`/api/shared/${token}`, () => HttpResponse.json(projection())),
  );
  render(<VisitorRoutes initialEntries={["/"]} />);
  await screen.findByRole("heading", { name: "Authored reis" });
  fireEvent.click(screen.getByRole("button", { name: m.forget_trip() }));
  act(() => changeLocale("en"));
  expect(screen.getByText(m.visitor_storage_failed())).toBeTruthy();
  expect(screen.getByRole("link", { name: /Authored reis/ }).getAttribute("href")).toBe(
    `/share/${token}`,
  );
});

it.each(["/missing", "/share/", "/trips/withdrawn"])(
  "translates unavailable and not-found routes at %s",
  async (path) => {
    serveApi(vi.fn(async () => new Response(null, { status: 404 })));
    render(<VisitorRoutes initialEntries={[path]} />);
    await screen.findByText(
      path === "/trips/withdrawn" ? m.unavailable_trip() : m.page_unavailable(),
    );
    act(() => changeLocale("en"));
    expect(
      screen.getByText(path === "/trips/withdrawn" ? m.unavailable_trip() : m.page_unavailable()),
    ).toBeTruthy();
  },
);
