// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { useVisualViewportFit } from "./use-visual-viewport";

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  change(height: number, offsetTop = 0) {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event("resize"));
  }
}

const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
afterEach(() => {
  if (original) Object.defineProperty(window, "visualViewport", original);
  else Reflect.deleteProperty(window, "visualViewport");
});

function install(viewport: FakeViewport) {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
}

it("leaves the sheet alone until a keyboard covers the bottom of the layout viewport", () => {
  const viewport = new FakeViewport();
  install(viewport);
  const { result } = renderHook(() => useVisualViewportFit(true));
  expect(result.current).toBeUndefined();

  act(() => viewport.change(480));
  expect(result.current).toEqual({ lift: 320, height: 480 });

  // iOS pans the visual viewport down inside the layout one: the sheet follows it.
  act(() => viewport.change(480, 100));
  expect(result.current).toEqual({ lift: 220, height: 480 });

  act(() => viewport.change(800));
  expect(result.current).toBeUndefined();
});

it("does nothing while the dialog is closed or the browser has no visual viewport", () => {
  const viewport = new FakeViewport();
  viewport.height = 400;
  install(viewport);
  expect(renderHook(() => useVisualViewportFit(false)).result.current).toBeUndefined();
  Reflect.deleteProperty(window, "visualViewport");
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  expect(renderHook(() => useVisualViewportFit(true)).result.current).toBeUndefined();
});
