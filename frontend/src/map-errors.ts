/** Tile requests that fail one after another, with no tile loaded in between, before the owner is told tiles are missing. */
export const TILE_FAILURES_BEFORE_NOTICE = 3;

/** MapLibre's error event: `tile` is set when a tile request failed. */
export type MapErrorEvent = { error?: unknown; tile?: unknown };

/** MapLibre aborts a request it no longer needs (the map moved on, or was removed). That is not a failure. */
export function isAbortedRequest(event: MapErrorEvent): boolean {
  return (event.error as { name?: unknown } | undefined)?.name === "AbortError";
}

/** A tile that could not be loaded. Style and layer problems have no tile, and an aborted request is not one either. */
export function isTileFailure(event: MapErrorEvent): boolean {
  return Boolean(event.tile) && !isAbortedRequest(event);
}

/**
 * Decides when the owner sees a map notice. Before the style loads, any real error means there is no map. After it
 * loads, only a run of failed tiles with none loaded in between does: one missing tile, a style or layer problem, or
 * an aborted request leaves the map usable and shows nothing.
 */
export function mapErrorReporter(notices: { style(): void; tiles(): void; clear(): void }) {
  let failedTiles = 0;
  let tilesShown = false;
  return {
    error(event: MapErrorEvent, styleLoaded: boolean) {
      if (isAbortedRequest(event)) return;
      if (!styleLoaded) return notices.style();
      if (isTileFailure(event) && ++failedTiles >= TILE_FAILURES_BEFORE_NOTICE) {
        tilesShown = true;
        notices.tiles();
      }
    },
    tileLoaded() {
      failedTiles = 0;
      if (tilesShown) {
        tilesShown = false;
        notices.clear();
      }
    },
  };
}
