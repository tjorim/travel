// @vitest-environment happy-dom
import { mockCaptureLocks } from "./capture-draft-test-utils";
import { beforeEach, expect, it, vi } from "vitest";
import { clearSession } from "./auth";
import { clearDraft, emptyDraft, readDraft, saveDraft } from "./tracker-model";
import { testToken } from "./query/test-utils";

function owner(subject: string) {
  sessionStorage.setItem(
    "travel-tracker-session",
    JSON.stringify({ accessToken: testToken(subject), expiresAt: Date.now() + 60000 }),
  );
}
beforeEach(() => {
  mockCaptureLocks();
  localStorage.clear();
  sessionStorage.clear();
});
it("never restores A's draft for B even with the old trip ID", async () => {
  owner("A");
  expect(await saveDraft({ ...emptyDraft("trip"), title: "A private draft" })).toBe("saved");
  owner("B");
  expect(readDraft("trip")).toBeNull();
});
it("does not let a stale draft overwrite a newer draft", async () => {
  owner("A");
  await saveDraft({ ...emptyDraft("trip"), title: "original" });
  const stale = readDraft("trip")!;
  const newer = readDraft("trip")!;
  await saveDraft({ ...newer, title: "newer" });
  await saveDraft({ ...stale, title: "stale" });
  expect(readDraft("trip")?.title).toBe("newer");
});
it("preserves unknown-owner legacy drafts verbatim without assigning them", async () => {
  const legacy = JSON.stringify({ trip: { ...emptyDraft("trip"), title: "Unknown owner" } });
  localStorage.setItem("travel-tracker-update-draft-v2", legacy);
  owner("B");
  expect(readDraft("trip")).toBeNull();
  expect(await saveDraft({ ...emptyDraft("trip"), title: "B draft" })).toBe("saved");
  expect(localStorage.getItem("travel-tracker-update-draft-v2")).toBe(legacy);
  owner("A");
  expect(readDraft("trip")).toBeNull();
});
it("retains a draft for its owner across logout while fencing old handles", async () => {
  owner("A");
  const draft = { ...emptyDraft("trip"), title: "A draft" };
  expect(await saveDraft(draft)).toBe("saved");
  clearSession();
  expect(await saveDraft({ ...draft, title: "late" })).toBe("inactive");
  expect(readDraft("trip")).toBeNull();
  owner("B");
  expect(readDraft("trip")).toBeNull();
  expect(await saveDraft(draft)).toBe("inactive");
  owner("A");
  expect(readDraft("trip")?.title).toBe("A draft");
  expect(await saveDraft(draft)).toBe("inactive");
});
it("serializes competing tab writes and fences stale clears and tombstone recreation", async () => {
  owner("A");
  const first = { ...emptyDraft("trip"), title: "first" };
  const second = { ...emptyDraft("trip"), title: "second" };
  expect(await Promise.all([saveDraft(first), saveDraft(second)])).toEqual(["saved", "conflict"]);
  expect(await clearDraft(second)).toBe("conflict");
  expect(await clearDraft(first)).toBe("saved");
  expect(await saveDraft(second)).toBe("conflict");
  expect(readDraft("trip")).toBeNull();
});
it("fences a queued write when the account changes before its lock is acquired", async () => {
  owner("A");
  const pending = saveDraft({ ...emptyDraft("trip"), title: "late" });
  owner("B");
  expect(await pending).toBe("inactive");
  owner("A");
  expect(readDraft("trip")).toBeNull();
});
it("fences writes after another tab signs the owner out", async () => {
  owner("A");
  const draft = { ...emptyDraft("trip"), title: "late" };
  localStorage.setItem("travel-capture-logout:A", "other-tab-logout");
  expect(await saveDraft(draft)).toBe("inactive");
});
it("handles denied reads, quota writes and missing Web Locks without claiming a save", async () => {
  owner("A");
  const draft = { ...emptyDraft("trip"), title: "in memory" };
  const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  expect(await saveDraft(draft)).toBe("unavailable");
  write.mockRestore();
  const read = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  expect(readDraft("trip")).toBeNull();
  expect(await saveDraft(draft)).toBe("unavailable");
  read.mockRestore();
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
  expect(await saveDraft(draft)).toBe("unavailable");
  expect(draft.title).toBe("in memory");
});
it.each([
  { mediaAssetIds: [7] },
  { location: { latitude: 91 } },
  { occurredAt: "not a date" },
  { title: {} },
  { notes: [] },
  { updateId: 12 },
  { tripId: "other" },
  { location: [] },
])("rejects malformed stored fields %j", async (invalid) => {
  owner("A");
  await saveDraft({ ...emptyDraft("trip"), title: "valid" });
  const key = "travel-capture-draft-v3:A:trip";
  const saved = JSON.parse(localStorage.getItem(key)!);
  Object.assign(saved.draft, invalid);
  localStorage.setItem(key, JSON.stringify(saved));
  expect(readDraft("trip")).toBeNull();
});
it("keeps incompatible pending data untouched instead of replacing it with an empty form", async () => {
  owner("A");
  const key = "travel-capture-draft-v3:A:trip";
  const raw = JSON.stringify({ version: 4, owner: "A", draft: { title: "future draft" } });
  localStorage.setItem(key, raw);
  expect(readDraft("trip")).toBeNull();
  expect(await saveDraft({ ...emptyDraft("trip"), title: "replacement" })).toBe("conflict");
  expect(localStorage.getItem(key)).toBe(raw);
});
it("does not invalidate another editor merely by restoring the same saved values", async () => {
  owner("A");
  const original = { ...emptyDraft("trip"), title: "original" };
  await saveDraft(original);
  await saveDraft(readDraft("trip")!);
  expect(await saveDraft({ ...original, title: "newer" })).toBe("saved");
});
it("does not serialize editor fences or credentials into record recovery or saved payloads", async () => {
  owner("A");
  const draft = { ...emptyDraft("trip"), title: "Synthetic draft" };
  await saveDraft(draft);
  const keys = ["tripId", "updateId", "occurredAt", "title", "notes", "location", "mediaAssetIds"];
  expect(Object.keys(JSON.parse(JSON.stringify(draft))).sort()).toEqual(keys.sort());
  const envelope = JSON.parse(localStorage.getItem("travel-capture-draft-v3:A:trip")!);
  expect(Object.keys(envelope.draft).sort()).toEqual(keys.sort());
  expect(localStorage.getItem("travel-capture-draft-v3:A:trip")).not.toContain(testToken("A"));
});
it("rolls back a write when another tab logs out between the fence check and storage write", async () => {
  owner("A");
  const draft = { ...emptyDraft("trip"), title: "original" };
  await saveDraft(draft);
  const setItem = localStorage.setItem.bind(localStorage);
  const spy = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
    setItem(key, value);
    if (key === "travel-capture-draft-v3:A:trip")
      setItem("travel-capture-logout:A", "concurrent logout");
  });
  expect(await saveDraft({ ...draft, title: "late" })).toBe("inactive");
  spy.mockRestore();
  expect(readDraft("trip")?.title).toBe("original");
});
