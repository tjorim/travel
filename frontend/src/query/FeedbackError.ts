/** Compose a local message without freezing the language at mutation time. */
export class FeedbackError extends Error {
  constructor(describe: () => string) {
    super();
    Object.defineProperty(this, "message", { get: describe });
  }
}
