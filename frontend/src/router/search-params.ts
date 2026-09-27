// Route search params use small, hand-written parse functions per route (no schema
// library such as zod/valibot). The app's forms already validate this way (see
// `src/forms/fields.tsx`); introduce a schema library only if a route's params grow
// enough to need composition or coercion beyond what a plain function reads cleanly.

/**
 * Parses a boolean-ish "on" flag search param (e.g. `/trips?new=1`), tolerating
 * `@tanstack/react-router`'s default search deserialization, which JSON-parses
 * digit-led string values and turns `"1"` into the number `1`. Any other value,
 * including `"0"` or `"true"`, is dropped rather than coerced.
 */
export function parseFlagParam(value: unknown): "1" | undefined {
  return value === "1" || value === 1 ? "1" : undefined;
}
