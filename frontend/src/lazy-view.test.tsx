// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Component, type ReactNode } from "react";

import { lazyNamed, lazyView } from "./lazy-view";
import { changeLocale } from "./locale";
import { m } from "./paraglide/messages.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  act(() => changeLocale("nl"));
});

const Loaded = ({ name }: { name: string }) => <p>{`geladen ${name}`}</p>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("lazyView", () => {
  it("announces the load politely, then renders the view with its props", async () => {
    const pending = deferred<{ default: typeof Loaded }>();
    const View = lazyView(() => pending.promise);
    render(<View name="Exampleland" />);
    expect(screen.getByRole("status")).toHaveTextContent(m.owner_view_loading());
    await act(async () => pending.resolve({ default: Loaded }));
    expect(await screen.findByText("geladen Exampleland")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("resolves a named export", async () => {
    const View = lazyNamed(async () => ({ Loaded }), "Loaded");
    render(<View name="Kyoto" />);
    expect(await screen.findByText("geladen Kyoto")).toBeInTheDocument();
  });

  it("shows a localized recovery state when the module cannot be fetched", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const View = lazyView<{ name: string }>(() =>
      Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
    );
    render(<View name="Exampleland" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(m.owner_view_unavailable());
    expect(alert).toHaveTextContent(m.owner_view_unavailable_description());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("recovers by reloading the page, which replays nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const View = lazyView<object>(() => Promise.reject(new TypeError("offline")));
    render(<View />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: m.owner_view_reload() }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("renders the recovery copy in the selected locale", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    act(() => changeLocale("en"));
    const View = lazyView<{ name: string }>(() => Promise.reject(new TypeError("offline")));
    render(<View name="Exampleland" />);
    expect(await screen.findByRole("heading", { name: m.owner_view_unavailable() })).toBeVisible();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeVisible();
  });

  it("leaves a rendering error to the boundary above instead of offering a retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Broken = () => {
      throw new Error("render failed");
    };
    class Catcher extends Component<{ children: ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        return this.state.error ? <p>{this.state.error.message}</p> : this.props.children;
      }
    }
    const View = lazyView(async () => ({ default: Broken }));
    render(
      <Catcher>
        <View />
      </Catcher>,
    );
    expect(await screen.findByText("render failed")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the surrounding layout mounted while the view loads and when it fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const View = lazyView<object>(() => Promise.reject(new TypeError("offline")));
    render(
      <>
        <nav aria-label="Navigatie" />
        <View />
      </>,
    );
    await screen.findByRole("alert");
    expect(screen.getByRole("navigation", { name: "Navigatie" })).toBeInTheDocument();
  });
});
