import { configure } from "@testing-library/react";

// Each test file runs in its own worker; on a busy machine the default one second is too tight for async UI.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout or scrolling; Base UI may scroll a highlighted option into view.
if (typeof Element !== "undefined") Element.prototype.scrollTo = () => undefined;
if (typeof window !== "undefined") window.scrollTo = () => undefined;

// Existing workflow fixtures exercise the Dutch base catalogue.
if (typeof document !== "undefined") document.documentElement.dataset.travelLocale = "nl";
