import { setupServer } from "msw/node";

import { handlers } from "./handlers";

/**
 * MSW Node server for Vitest, started in src/test-setup.ts. Add per-test routes with `server.use(...)`; they are
 * dropped again after each test.
 */
export const server = setupServer(...handlers);
