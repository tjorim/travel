/** Require a chosen wire schema: inference must not bless arbitrary successful payloads. */
export function jsonResponse<T = never>(body: NoInfer<T>, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init);
}

/** Only malformed, error, transport-control and persistence fixtures may bypass the wire contract.
 * Explain the concrete exception at every call site. */
export function fixtureResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init);
}
