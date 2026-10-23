import script from "../public/appearance.js?raw";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function boot(stored: string | null = null, dark = false, blocked = false) {
  const window = new Window({
    url: "http://localhost:3000/admin/",
    settings: { device: { prefersColorScheme: dark ? "dark" : "light" } },
  });
  windows.push(window);
  window.document.head.innerHTML = '<meta name="theme-color" />';
  if (stored !== null) window.localStorage.setItem("travel-appearance", stored);
  const root = window.document.documentElement;
  const storage = {
    getItem: () => {
      if (blocked) throw Error();
      return window.localStorage.getItem("travel-appearance");
    },
    setItem: (_key: string, value: string) => {
      if (blocked) throw Error();
      window.localStorage.setItem(_key, value);
    },
  };
  new Function("window", "document", "localStorage", "Event", script)(
    window,
    window.document,
    storage,
    window.Event,
  );
  return {
    window,
    root,
    storage,
    color: () => window.document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    stored: () => window.localStorage.getItem("travel-appearance"),
  };
}
describe("device appearance bootstrap", () => {
  it("applies a saved choice before the app loads and updates browser chrome", () => {
    const state = boot("dark");
    expect(state.root.dataset).toEqual({ appearance: "dark", theme: "dark" });
    expect(state.color()).toBe("#101c18");
    state.window.dispatchEvent(
      Object.assign(new state.window.Event("travel-appearance-set"), { detail: "light" }),
    );
    expect(state.root.dataset.theme).toBe("light");
    expect(state.stored()).toBe("light");
    expect(state.color()).toBe("#f5f0e8");
  });
  it("follows OS changes live only in auto", () => {
    const state = boot("invalid");
    // Happy DOM reevaluates existing media queries on resize.
    state.window.happyDOM.settings.device.prefersColorScheme = "dark";
    state.window.dispatchEvent(new state.window.Event("resize"));
    expect(state.root.dataset.theme).toBe("dark");
    state.window.dispatchEvent(
      Object.assign(new state.window.Event("travel-appearance-set"), { detail: "light" }),
    );
    state.window.happyDOM.settings.device.prefersColorScheme = "light";
    state.window.dispatchEvent(new state.window.Event("resize"));
    expect(state.root.dataset.theme).toBe("light");
  });
  it("works when device storage is unavailable", () => {
    const state = boot(null, true, true);
    expect(state.root.dataset.theme).toBe("dark");
    state.window.dispatchEvent(
      Object.assign(new state.window.Event("travel-appearance-set"), { detail: "light" }),
    );
    expect(state.root.dataset.theme).toBe("light");
  });
  it("synchronizes other tabs and storage clearing", () => {
    const state = boot("dark", false);
    state.storage.setItem("travel-appearance", "light");
    state.window.dispatchEvent(
      Object.assign(new state.window.Event("storage"), { key: "travel-appearance" }),
    );
    expect(state.root.dataset.appearance).toBe("light");
    state.storage.setItem("travel-appearance", "auto");
    state.window.dispatchEvent(Object.assign(new state.window.Event("storage"), { key: null }));
    expect(state.root.dataset.theme).toBe("light");
  });
});
