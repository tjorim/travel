import type { RequestHandler } from "msw";

/**
 * Handlers every test shares. Empty on purpose: the API is large and each suite cares about different routes, so a
 * suite declares the routes it needs with `server.use(...)`. Anything it forgets fails the test (see test-setup.ts).
 */
export const handlers: RequestHandler[] = [];
