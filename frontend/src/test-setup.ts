import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./mocks/server";

// Each test file runs in its own worker; on a busy machine the default one second is too tight for async UI.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout or scrolling; Base UI may scroll a highlighted option into view.
if (typeof Element !== "undefined") Element.prototype.scrollTo = () => undefined;
if (typeof window !== "undefined") window.scrollTo = () => undefined;

// Existing workflow fixtures exercise the Dutch base catalogue.
if (typeof document !== "undefined") document.documentElement.dataset.travelLocale = "nl";

// Network mocking. Unhandled requests fail the test instead of reaching the real network.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
