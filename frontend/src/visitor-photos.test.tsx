// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { stubViewport } from "./mocks/viewport";
import { changeLocale } from "./locale";
import { ProjectionView, type Projection, type ProjectionMedia } from "./ProjectionView";
import { fixture } from "./test-projection";
import { m } from "./paraglide/messages.js";

const photo = (index: number, update = "update") =>
  fixture<ProjectionMedia>({
    id: `photo-${index}`,
    image: { id: `photo-${index}` },
    alt_text: `Foto ${index}`,
    caption: `Onderschrift ${index}`,
    width: 1200,
    height: 800,
    update,
  });
function trip(count: number, extra: Partial<Projection> = {}): Projection {
  return fixture<Projection>({
    schema_version: "travel/public-trip@1",
    title: "Voorbeeldreis",
    summary: null,
    dates: null,
    visits: [],
    places: [],
    stays: [],
    navigation: [],
    routes: [],
    updates: [{ id: "update", title: "Een dag", body: "Tekst." }],
    media: Array.from({ length: count }, (_, i) => photo(i + 1)),
    ...extra,
  });
}
const show = (data: Projection) =>
  render(<ProjectionView projection={data} audience="public" identifier="safe-slug" />);

// Tab panels are only hidden below the side-by-side width; these tests read the whole page.
beforeEach(() => {
  stubViewport(true);
  act(() => changeLocale("en"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps one photo large and arranges two or more as a mosaic with a visible count", () => {
  const one = show(trip(1));
  expect(one.container.querySelector("[data-mosaic]")).toBeNull();
  expect(screen.queryByText(/\d+ photos?/)).toBeNull();
  // One photo keeps its caption under it.
  expect(screen.getByText("Onderschrift 1")).toBeTruthy();
  one.unmount();

  const two = show(trip(2));
  expect(two.container.querySelectorAll("[data-mosaic] > li")).toHaveLength(2);
  expect(screen.getByText("2 photos")).toBeTruthy();
  two.unmount();

  const six = show(trip(6));
  const tiles = [...six.container.querySelectorAll("[data-mosaic] > li")];
  expect(tiles).toHaveLength(6);
  // A large first photo over three tiles and two wider tiles: every row fills the width.
  expect(tiles.map((tile) => tile.className.match(/col-span-\d/)?.[0])).toEqual([
    "col-span-6",
    "col-span-2",
    "col-span-2",
    "col-span-2",
    "col-span-3",
    "col-span-3",
  ]);
  expect(screen.getByText("6 photos")).toBeTruthy();
  // Every photo is its own button, named by its alt text; captions are left to the lightbox.
  for (let i = 1; i <= 6; i++)
    expect(screen.getByRole("button", { name: `Open image: Foto ${i}` })).toBeTruthy();
  expect(screen.queryByText("Onderschrift 2")).toBeNull();
  six.unmount();

  // Seven tiles under the lead would leave one alone in the last row, so the last two rows pair up.
  const eight = show(trip(8));
  expect(
    [...eight.container.querySelectorAll("[data-mosaic] > li")]
      .slice(1)
      .map((tile) => tile.className.match(/col-span-\d/)?.[0]),
  ).toEqual([
    "col-span-2",
    "col-span-2",
    "col-span-2",
    "col-span-3",
    "col-span-3",
    "col-span-3",
    "col-span-3",
  ]);
});

it("counts photos in Dutch and keeps a video in its own frame under the mosaic", () => {
  act(() => changeLocale("nl"));
  const data = trip(3);
  data.media.push(
    fixture<ProjectionMedia>({
      id: "clip",
      video: { id: "clip" },
      alt_text: "Filmpje",
      update: "update",
    }),
  );
  const view = show(data);
  expect(screen.getByText("3 foto's")).toBeTruthy();
  expect(m.visitor_photo_count({ count: 1 })).toBe("1 foto");
  expect(view.container.querySelectorAll("[data-mosaic] > li")).toHaveLength(3);
  expect(view.container.querySelector("video")).toBeTruthy();
  expect(view.container.querySelector("[data-mosaic] video")).toBeNull();
});

it("opens a dark lightbox that announces the position and has no language switch", async () => {
  show(trip(6));
  const opener = screen.getByRole("button", { name: "Open image: Foto 3" });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Foto 3" });
  expect(within(dialog).getByText("Photo 3 of 6")).toBeTruthy();
  expect(within(dialog).getByText("Onderschrift 3")).toBeTruthy();
  // Delivered alt texts and captions have no translation to switch to, so there is nothing to switch here.
  expect(within(dialog).queryByRole("radio")).toBeNull();
  expect(within(dialog).queryByRole("radiogroup")).toBeNull();
  expect(within(dialog).queryByText("Nederlands")).toBeNull();
  expect(within(dialog).queryByText("English")).toBeNull();
  act(() => changeLocale("nl"));
  expect(within(dialog).getByText("Foto 3 van 6")).toBeTruthy();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("changes photo with a touch swipe but not with a short drag, a vertical drag or a mouse", async () => {
  show(trip(4));
  fireEvent.click(screen.getByRole("button", { name: "Open image: Foto 2" }));
  const dialog = await screen.findByRole("dialog", { name: "Foto 2" });
  const stage = dialog.querySelector(".touch-pan-y")!;
  const drag = (from: [number, number], to: [number, number], pointerType = "touch") => {
    fireEvent.pointerDown(stage, { pointerType, clientX: from[0], clientY: from[1] });
    fireEvent.pointerUp(stage, { pointerType, clientX: to[0], clientY: to[1] });
  };
  drag([300, 200], [290, 200]);
  drag([300, 200], [100, 400]);
  drag([300, 200], [100, 200], "mouse");
  expect(within(dialog).getByText("Photo 2 of 4")).toBeTruthy();
  drag([300, 200], [100, 200]);
  expect(await screen.findByRole("dialog", { name: "Foto 3" })).toBeTruthy();
  drag([100, 200], [300, 200]);
  drag([100, 200], [300, 200]);
  expect(await screen.findByRole("dialog", { name: "Foto 1" })).toBeTruthy();
  // The first photo has no previous one: the swipe stops there.
  drag([100, 200], [300, 200]);
  expect(within(screen.getByRole("dialog")).getByText("Photo 1 of 4")).toBeTruthy();
});

const cover = (extra: Partial<Projection> = {}): Projection =>
  trip(2, {
    cover: "photo-1",
    dates: { starts_on: "2054-11-01", ends_on: "2054-11-21", date_precision: "day" },
    ...extra,
  });

it("puts the title over a cover hero, with the photo behind it and its caption under it", () => {
  const view = show(cover());
  const hero = view.container.querySelector("[data-hero]")!;
  expect(hero).toBeTruthy();
  const heading = within(hero as HTMLElement).getByRole("heading", { level: 1 });
  expect(heading.textContent).toBe("Voorbeeldreis");
  expect(hero.querySelector("[data-hero-text]")!.contains(heading)).toBe(true);
  expect(hero.querySelector("[data-hero-text]")!.contains(hero.querySelector("img"))).toBe(false);
  // The title comes first in the document, then the photo, which has its own alt text.
  expect(
    heading.compareDocumentPosition(hero.querySelector("[data-hero-image]")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(hero as HTMLElement).getByText("Onderschrift 1")).toBeTruthy();
});

it("keeps the text header without a cover, and when the cover cannot load", () => {
  const without = show(cover({ cover: null }));
  expect(without.container.querySelector("[data-hero]")).toBeNull();
  expect(without.container.querySelector("header")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 1, name: "Voorbeeldreis" })).toBeTruthy();
  without.unmount();

  const failing = show(cover());
  fireEvent.error(failing.container.querySelector("[data-hero-image]")!);
  expect(failing.container.querySelector("[data-hero]")).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: "Voorbeeldreis" })).toBeTruthy();
});
