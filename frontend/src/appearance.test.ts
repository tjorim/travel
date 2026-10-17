import script from "../public/appearance.js?raw";
import { describe, expect, it } from "vitest";

function boot(stored: string | null = null, dark = false, blocked = false) {
  const window = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: dark });
  const root = { dataset: {} as Record<string, string> };
  let color = "";
  const storage = {
    getItem: () => {
      if (blocked) throw Error();
      return stored;
    },
    setItem: (_key: string, value: string) => {
      if (blocked) throw Error();
      stored = value;
    },
  };
  new Function("window", "document", "localStorage", "Event", script)(
    Object.assign(window, { matchMedia: () => media }),
    {
      documentElement: root,
      querySelector: () => ({
        setAttribute: (_key: string, value: string) => {
          color = value;
        },
      }),
    },
    storage,
    Event,
  );
  return { window, media, root, storage, color: () => color, stored: () => stored };
}
describe("device appearance bootstrap", () => {
  it("applies a saved choice before the app loads and updates browser chrome", () => {
    const state = boot("dark");
    expect(state.root.dataset).toEqual({ appearance: "dark", theme: "dark" });
    expect(state.color()).toBe("#101c18");
    state.window.dispatchEvent(
      Object.assign(new Event("travel-appearance-set"), { detail: "light" }),
    );
    expect(state.root.dataset.theme).toBe("light");
    expect(state.stored()).toBe("light");
    expect(state.color()).toBe("#f5f0e8");
  });
  it("follows OS changes live only in auto", () => {
    const state = boot("invalid");
    state.media.matches = true;
    state.media.dispatchEvent(new Event("change"));
    expect(state.root.dataset.theme).toBe("dark");
    state.window.dispatchEvent(
      Object.assign(new Event("travel-appearance-set"), { detail: "light" }),
    );
    state.media.dispatchEvent(new Event("change"));
    expect(state.root.dataset.theme).toBe("light");
  });
  it("works when device storage is unavailable", () => {
    const state = boot(null, true, true);
    expect(state.root.dataset.theme).toBe("dark");
    state.window.dispatchEvent(
      Object.assign(new Event("travel-appearance-set"), { detail: "light" }),
    );
    expect(state.root.dataset.theme).toBe("light");
  });
  it("synchronizes other tabs and storage clearing", () => {
    const state = boot("dark", false);
    state.storage.setItem("travel-appearance", "light");
    state.window.dispatchEvent(Object.assign(new Event("storage"), { key: "travel-appearance" }));
    expect(state.root.dataset.appearance).toBe("light");
    state.storage.setItem("travel-appearance", "auto");
    state.window.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
    expect(state.root.dataset.theme).toBe("light");
  });
});
