import { describe, expect, it, vi } from "vitest";
import { isAbortedRequest, isTileFailure, mapErrorReporter } from "./map-errors";

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function setup() {
  const notices = { style: vi.fn(), tiles: vi.fn(), clear: vi.fn() };
  return { notices, reporter: mapErrorReporter(notices) };
}

const tileFailure = () => ({ error: new Error("503 Service Unavailable"), tile: {} });

describe("map error classification", () => {
  it("treats an aborted request as no failure, whatever its error type", () => {
    expect(isAbortedRequest({ error: abortError(), tile: {} })).toBe(true);
    expect(isTileFailure({ error: abortError(), tile: {} })).toBe(false);
    expect(isAbortedRequest({ error: new DOMException("aborted", "AbortError") })).toBe(true);
  });

  it("counts a tile that failed for another reason, but not a style or layer problem", () => {
    expect(isTileFailure(tileFailure())).toBe(true);
    expect(isTileFailure({ error: new Error("layers.stops.paint.circle-color: no color") })).toBe(
      false,
    );
  });
});

describe("mapErrorReporter", () => {
  it("shows the style notice for a real error before the style loads", () => {
    const { notices, reporter } = setup();
    reporter.error({ error: new Error("style 500") }, false);
    expect(notices.style).toHaveBeenCalledOnce();
    expect(notices.tiles).not.toHaveBeenCalled();
  });

  it("shows nothing for an aborted request, even before the style loads", () => {
    const { notices, reporter } = setup();
    reporter.error({ error: abortError() }, false);
    reporter.error({ error: abortError(), tile: {} }, true);
    expect(notices.style).not.toHaveBeenCalled();
    expect(notices.tiles).not.toHaveBeenCalled();
  });

  it("shows nothing for one failed tile while the map draws", () => {
    const { notices, reporter } = setup();
    reporter.error(tileFailure(), true);
    expect(notices.tiles).not.toHaveBeenCalled();
  });

  it("shows the tiles notice after a run of failed tiles with none loaded", () => {
    const { notices, reporter } = setup();
    for (let i = 0; i < 3; i++) reporter.error(tileFailure(), true);
    expect(notices.tiles).toHaveBeenCalledOnce();
  });

  it("starts the run again after a tile loads, and clears a notice it had shown", () => {
    const { notices, reporter } = setup();
    reporter.error(tileFailure(), true);
    reporter.error(tileFailure(), true);
    reporter.tileLoaded();
    reporter.error(tileFailure(), true);
    expect(notices.tiles).not.toHaveBeenCalled();
    reporter.error(tileFailure(), true);
    reporter.error(tileFailure(), true);
    expect(notices.tiles).toHaveBeenCalledOnce();
    reporter.tileLoaded();
    expect(notices.clear).toHaveBeenCalledOnce();
  });

  it("ignores style and layer errors after the style has loaded", () => {
    const { notices, reporter } = setup();
    for (let i = 0; i < 5; i++)
      reporter.error({ error: new Error('Cannot add layer "x" before non-existing layer') }, true);
    expect(notices.style).not.toHaveBeenCalled();
    expect(notices.tiles).not.toHaveBeenCalled();
  });
});
