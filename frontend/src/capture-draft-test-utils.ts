import { vi } from "vitest";

/** A deterministic exclusive Web Locks model for draft tests; real tabs are covered by Playwright. */
export function mockCaptureLocks() {
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((name: string, callback: () => unknown) => {
        const next = (queues.get(name) ?? Promise.resolve()).then(callback);
        queues.set(
          name,
          next.catch(() => undefined),
        );
        return next;
      }),
    },
  });
}
