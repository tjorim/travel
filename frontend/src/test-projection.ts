import type { Projection } from "./api-types";

/**
 * A visitor-document record for a test. Tests name only the fields they are about, and some add a private one on
 * purpose to prove it is never shown, so a fixture is not held to the full contract the app's own types state.
 */
export function fixture<T>(value: object): T {
  return value as T;
}

type Collection = "visits" | "places" | "updates" | "stays" | "media" | "routes" | "navigation";

/**
 * A document whose collections take sparse records (see `fixture`). It still passes wherever a `Projection` is
 * expected, so a test can build and change one without spelling out every delivered field.
 */
// oxlint-disable-next-line typescript/no-explicit-any
export type SparseProjection = Omit<Projection, Collection> & Record<Collection, any[]>;
