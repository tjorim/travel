import { vi } from "vitest";

/** Stubs the viewport as wide (story and map side by side) or narrow (one view at a time). */
export function stubViewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1100px)" ? wide : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
