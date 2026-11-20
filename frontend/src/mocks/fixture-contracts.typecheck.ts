import type * as Api from "@/api-schema";
import type { Route } from "@playwright/test";
import { json as browserJson } from "../../e2e/mock-api";
import { FakeApi } from "@/query/fake-api";
import { jsonResponse } from "./response";
import { responseFixtures } from "./response-test-fixtures";

/** Compile-only regressions: removing NoInfer or widening a helper makes an expect-error unused. */
export function verifyFixtureContracts(route: Route) {
  const api = new FakeApi();
  jsonResponse<Api.TripResponse>(responseFixtures.TripResponse);
  browserJson<Api.TripResponse>(route, responseFixtures.TripResponse);
  // @ts-expect-error A response schema cannot be inferred from an arbitrary payload.
  jsonResponse({ renamed_id: "wrong" });
  // @ts-expect-error Browser responses also require an explicit schema.
  browserJson(route, { renamed_id: "wrong" });
  // @ts-expect-error Missing required wire fields must fail even with an explicit schema.
  jsonResponse<Api.TripResponse>({ id: "only-an-id" });
  browserJson<Api.ProjectionDocument>(route, {
    ...responseFixtures.ProjectionDocument,
    // @ts-expect-error Nested response fields are checked too.
    dates: { starts_on: null, ends_on: null },
  });
  // @ts-expect-error Collections cannot infer their schema from a sparse row.
  api.collection("/api/trips", [{ id: "only-an-id" }]);
  // @ts-expect-error Registered single responses cannot infer arbitrary payload types.
  api.value("/api/trips/trip", { renamed_id: "wrong" });
  // @ts-expect-error Custom responders cannot infer arbitrary success types.
  api.on("GET", /trips$/, () => ({ renamed_id: "wrong" }));
  // @ts-expect-error A chosen collection model also checks create callbacks.
  api.collection<Api.TripResponse>("/api/trips", [], { create: () => ({ id: "only-an-id" }) });
  // @ts-expect-error Pushed persistence rows must choose a schema.
  api.push("/api/trips", { id: "only-an-id" });
}
