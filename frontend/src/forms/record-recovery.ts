import { decodeSubject, readSession } from "../auth";

/** Tab-scoped emergency recovery. Never serialise uploads or other non-JSON values. */
export function serializableRecord(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(serializableRecord);
  return (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.values(value).every(serializableRecord)
  );
}

export function readRecovery<T>(key: string): { baseline: string; values: T } | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (
      !saved ||
      typeof saved.baseline !== "string" ||
      !saved.values ||
      typeof saved.values !== "object" ||
      Array.isArray(saved.values) ||
      !serializableRecord(saved.values)
    )
      return null;
    sessionStorage.removeItem(key);
    return saved;
  } catch {
    return null;
  }
}

export function recordRecoveryKey(baseline: unknown): string {
  const source = JSON.stringify(baseline);
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const session = readSession();
  const owner = session ? decodeSubject(session.accessToken) : "anonymous";
  return `travel-record-draft:${owner}:${window.location.pathname}:${hash >>> 0}`;
}
