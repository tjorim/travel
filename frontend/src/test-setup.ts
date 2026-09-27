import { configure } from "@testing-library/react";

// Each test file runs in its own worker; on a busy machine the default one second is too tight for async UI.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout, so react-select's menu-scrolling logs "not implemented" noise without this.
if (typeof Element !== "undefined") Element.prototype.scrollTo = () => undefined;
