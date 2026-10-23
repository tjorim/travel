import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./mocks/server";

// Each test file runs in its own worker; on a busy machine the default one second is too tight for async UI.
configure({ asyncUtilTimeout: 5000 });

// The test DOM has no layout or scrolling; Base UI may scroll a highlighted option into view.
if (typeof Element !== "undefined") Element.prototype.scrollTo = () => undefined;
if (typeof window !== "undefined") window.scrollTo = () => undefined;

// Existing workflow fixtures exercise the Dutch base catalogue.
if (typeof document !== "undefined") document.documentElement.dataset.travelLocale = "nl";

// Network mocking. Unhandled requests fail the test instead of reaching the real network.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Happy DOM activates labels while bubbling, before React's delegated handlers can
// cancel the click. Run label activation at document level, after React, so Base UI
// checkboxes do not toggle twice when nested inside a label.
if (typeof HTMLLabelElement !== "undefined") {
  const dispatchLabelEvent = HTMLLabelElement.prototype.dispatchEvent;
  HTMLLabelElement.prototype.dispatchEvent = function (event) {
    return this.querySelector('[role="checkbox"]')
      ? HTMLElement.prototype.dispatchEvent.call(this, event)
      : dispatchLabelEvent.call(this, event);
  };
  document.addEventListener("click", (event) => {
    // user-event owns activation when it has already cancelled the native event.
    const nativePrevented = Object.getOwnPropertyDescriptor(
      Event.prototype,
      "defaultPrevented",
    )?.get?.call(event);
    if (nativePrevented || event.defaultPrevented || !(event.target instanceof Element)) return;
    const label = event.target.closest("label");
    const control = label?.querySelector('[role="checkbox"]') ? label.control : null;
    if (control && event.target !== control && !control.contains(event.target)) {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
  });
}
