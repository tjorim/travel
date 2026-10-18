import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../public/service-worker.js", import.meta.url), "utf8");

type Handler = (event: unknown) => void;

/** Runs the worker against an in-memory Cache Storage, returning its registered listeners. */
function boot(network: (request: { url: string }) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (request: { url: string } | string) => {
        const hit = store.get(typeof request === "string" ? request : request.url);
        return hit?.clone();
      },
      put: async (request: { url: string } | string, response: Response) => {
        store.set(typeof request === "string" ? request : request.url, response);
      },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request: { url: string }) => store.delete(request.url),
      addAll: async () => undefined,
    };
  };
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: { url: string } | string) => {
      for (const name of stores.keys()) {
        const hit = await open(name).match(request);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const listeners: Record<string, Handler> = {};
  const scope = {
    location: new URL("https://travel.example/admin/service-worker.js"),
    addEventListener: (type: string, handler: Handler) => (listeners[type] = handler),
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };
  new Function("self", "caches", "fetch", source)(scope, caches, network);
  const dispatch = async (url: string, init: { mode?: string; method?: string } = {}) => {
    const request = { url, method: init.method ?? "GET", mode: init.mode ?? "cors" };
    let response: Promise<Response> | undefined;
    listeners.fetch({
      request,
      respondWith: (value: Promise<Response>) => (response = value),
      waitUntil: () => undefined,
    });
    return response ? await response : undefined;
  };
  return { stores, dispatch };
}

describe("owner service worker asset cache", () => {
  const asset = "https://travel.example/admin/assets/Library-abc.js";

  it("keeps a fetched chunk so it still loads offline", async () => {
    let online = true;
    const network = vi.fn(async () => {
      if (!online) throw new TypeError("offline");
      return new Response("export default 1", { status: 200 });
    });
    const { dispatch } = boot(network);

    expect(await (await dispatch(asset))!.text()).toBe("export default 1");
    online = false;
    expect(await (await dispatch(asset))!.text()).toBe("export default 1");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("fails a chunk that was never fetched while offline, so the app can offer recovery", async () => {
    const { dispatch } = boot(async () => {
      throw new TypeError("offline");
    });
    await expect(dispatch("https://travel.example/admin/assets/Settings-def.js")).rejects.toThrow(
      "offline",
    );
  });

  it("never stores an error response such as a retired chunk's 404", async () => {
    const network = vi.fn(async () => new Response("missing", { status: 404 }));
    const { dispatch, stores } = boot(network);
    expect((await dispatch(asset))!.status).toBe(404);
    expect(stores.get("travel-admin-assets-v1")?.size ?? 0).toBe(0);
  });

  it("leaves requests outside the hashed assets alone", async () => {
    const { dispatch } = boot(async () => new Response("api"));
    expect(await dispatch("https://travel.example/api/trips")).toBeUndefined();
    expect(
      await dispatch("https://travel.example/admin/assets/x.js", { method: "POST" }),
    ).toBeUndefined();
  });

  it("drops the oldest chunks past its limit", async () => {
    const { dispatch, stores } = boot(async () => new Response("chunk"));
    for (let index = 0; index < 205; index++)
      await dispatch(`https://travel.example/admin/assets/chunk-${index}.js`);
    const kept = [...stores.get("travel-admin-assets-v1")!.keys()];
    expect(kept).toHaveLength(200);
    expect(kept).not.toContain("https://travel.example/admin/assets/chunk-0.js");
    expect(kept).toContain("https://travel.example/admin/assets/chunk-204.js");
  });
});
