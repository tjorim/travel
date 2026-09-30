// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { m } from "./paraglide/messages.js";
import { renderWithOwner, resetOfflineDb, testToken } from "./query/test-utils";
import { DocumentLibraryManager } from "./library/DocumentLibraryManager";
import { PublicationManager } from "./trips/PublicationManager";
import { PackingManager } from "./trips/PackingManager";
import { PackingOfflineView } from "./trips/PackingOfflineView";
import { OfflineManager } from "./offline/OfflineManager";
import { OfflineSnapshotView } from "./offline/OfflineSnapshotView";
import { OfflineUnsupportedError, openOfflineCopy, pinOfflineCopy } from "./offline/offline-store";
import type { OfflineCopySummary } from "./offline/offline-store";
import type { Trip } from "./tracker-model";

const auth = vi.hoisted(() => ({ session: { accessToken: "" } }));
vi.mock("./auth-context", () => ({ useAuth: () => auth }));
vi.mock("./TripMap", () => ({ TripMap: ({ points }: { points: { detail: string }[] }) => <p>{points[0]?.detail}</p> }));
const trip: Trip = {
  id: "trip",
  title: "Eigen reis",
  summary: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const scope = { schema_version: "travel/share-scope@1", trip: { title: true, summary: true, dates: null }, items: [] };
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  act(() => changeLocale("nl"));
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  act(() => changeLocale("nl"));
  await resetOfflineDb();
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

it("keeps a selected upload, authored title, focus and discard confirmation when switching", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json([]))),
  );
  renderWithOwner(<DocumentLibraryManager />);
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  const title = screen.getByRole("textbox", { name: "Titel" }) as HTMLInputElement;
  const upload = screen.getByLabelText("Privébestand") as HTMLInputElement;
  const file = new File(["private"], "Eigen naam.pdf", { type: "application/pdf" });
  fireEvent.change(title, { target: { value: "Eigen document" } });
  fireEvent.change(upload, { target: { files: [file] } });
  title.focus();
  act(() => changeLocale("en"));
  expect(screen.getByRole("textbox", { name: "Title" })).toBe(title);
  expect(document.activeElement).toBe(title);
  expect(upload.files?.[0]).toBe(file);
  expect(title.value).toBe("Eigen document");
  fireEvent.click(screen.getByRole("button", { name: "Close Upload document" }));
  await screen.findByRole("alertdialog", { name: "Discard changes?" });
  act(() => changeLocale("nl"));
  expect(screen.getByRole("alertdialog", { name: "Wijzigingen verwerpen?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verder bewerken" }));
  expect(upload.files?.[0]).toBe(file);
});

it("preserves a dirty sharing editor and confirmation without changing its scope or name", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        json(
          url.endsWith("public-projection")
            ? { trip_id: "trip", slug: "eigen-reis", surface_state: "unpublished", scope }
            : url.endsWith("overview")
              ? { audiences: [], warnings: [] }
              : url.endsWith("share-links")
                ? [
                    {
                      id: "link",
                      series_id: "link",
                      label: "Eigen publiek",
                      state: "draft",
                      scope,
                      token: null,
                      expires_at: null,
                    },
                  ]
                : [],
        ),
      ),
    ),
  );
  renderWithOwner(<PublicationManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: /Eigen publiek/ }));
  const name = screen.getByRole("textbox", { name: "Naam van de link" }) as HTMLInputElement;
  fireEvent.change(name, { target: { value: "Familie · zelf geschreven" } });
  act(() => changeLocale("en"));
  expect(screen.getByRole("textbox", { name: "Link name" })).toBe(name);
  expect(name.value).toBe("Familie · zelf geschreven");
  fireEvent.click(screen.getByRole("button", { name: "Close Edit share link" }));
  await screen.findByRole("alertdialog", { name: "Discard changes?" });
  act(() => changeLocale("nl"));
  expect(screen.getByRole("alertdialog", { name: "Wijzigingen verwerpen?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verder bewerken" }));
  expect(name.value).toBe("Familie · zelf geschreven");
});

it("keeps a pending packing toggle, retranslates its failure and submits canonical values", async () => {
  let rejectToggle!: (value: Response) => void;
  const item = {
    id: "item",
    label: "Eigen item",
    quantity: 1,
    category: "Zonder categorie",
    bag_id: null,
    position: 0,
    packed: false,
    weight_g: 1250,
    notes: null,
    essential: false,
    last_minute: false,
    valuable: false,
    cabin_only: false,
    checked_only: false,
  };
  const request = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PATCH")
      return new Promise<Response>((resolve) => {
        rejectToggle = resolve;
      });
    return Promise.resolve(
      json(
        url.endsWith("packing-lists") ? [{ id: "list", name: "Packing list" }] : url.endsWith("/items") ? [item] : [],
      ),
    );
  });
  vi.stubGlobal("fetch", request);
  renderWithOwner(<PackingManager trip={trip} />);
  const toggle = await screen.findByRole("checkbox", { name: "Eigen item ingepakt" });
  fireEvent.click(toggle);
  await waitFor(() => expect(rejectToggle).toBeTypeOf("function"));
  act(() => changeLocale("en"));
  expect(screen.getByRole("checkbox", { name: "Eigen item packed" })).toBe(toggle);
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.getAttribute("aria-disabled")).toBe("true");
  const patch = request.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(String(patch[1]?.body))).toEqual({ packed: true });
  await act(async () => rejectToggle(json({ detail: "diagnostic only" }, 503)));
  await screen.findByText(/Checking off failed/);
  act(() => changeLocale("nl"));
  expect(screen.getByText(/Afvinken mislukt/)).toBeTruthy();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText(/1,25 kg per stuk/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Als sjabloon bewaren" })).toBeTruthy();
});

it("reopens canonical packing data without merging authored categories with the fallback", async () => {
  const snapshot = {
    list: { id: "list", name: "Packing list" },
    bags: [],
    savedAt: Date.now(),
    items: [
      {
        id: "one",
        label: "Eigen één",
        quantity: 1,
        category: "Zonder categorie",
        bag_id: null,
        position: 0,
        packed: true,
        notes: null,
        last_minute: false,
      },
      {
        id: "two",
        label: "Eigen twee",
        quantity: 1,
        category: null,
        bag_id: null,
        position: 1,
        packed: false,
        notes: null,
        last_minute: false,
      },
    ],
  };
  const open = vi.fn(() => Promise.resolve(new Blob([JSON.stringify(snapshot)])));
  renderWithOwner(<PackingOfflineView copy={{ id: "copy" } as OfflineCopySummary} open={open} />);
  await screen.findByText("Eigen één");
  fireEvent.click(screen.getByRole("radio", { name: "Per categorie" }));
  expect(screen.getAllByRole("region", { name: "Zonder categorie" })).toHaveLength(2);
  act(() => changeLocale("en"));
  expect(within(screen.getByRole("region", { name: "Zonder categorie" })).getByText("Eigen één")).toBeTruthy();
  expect(within(screen.getByRole("region", { name: "Uncategorised" })).getByText("Eigen twee")).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Eigen één packed" }).getAttribute("aria-disabled")).toBe("true");
  expect(open).toHaveBeenCalledOnce();
});

it("renders legacy emergency and map display metadata in the current locale without rewriting authored data", () => {
  const text = JSON.stringify({
    kind: "Medische notitie",
    label: "Medical note",
    value: "Eigen waarde",
    notes: "Contactpersoon",
  });
  const view = renderWithOwner(<OfflineSnapshotView kind="emergency_info" text={text} />);
  expect(screen.getByText("Medische notitie")).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getAllByText("Medical note")).toHaveLength(2);
  expect(screen.getByText("Contactpersoon")).toBeTruthy();
  view.unmount();
  renderWithOwner(
    <OfflineSnapshotView
      kind="route_data"
      text={JSON.stringify({ points: [{ kind: "derived", detail: "Afgeleid uit privélocaties" }], lines: [] })}
    />,
  );
  expect(screen.getByText("Derived from private locations")).toBeTruthy();
});

it("renders plural counts and retained local offline errors in either language", async () => {
  const unsupported = new OfflineUnsupportedError();
  let unavailable: unknown;
  try {
    await openOfflineCopy("other-subject", "missing");
  } catch (error) {
    unavailable = error;
  }
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    expect(unsupported.message).toBe(m.assets_offline_storage_is_not_supported_in_this_browser());
    expect((unavailable as Error).message).toBe(m.assets_this_offline_copy_is_not_available_for_this_account());
    for (const count of [0, 1, 3]) {
      expect(m.assets_offline_copies_count({ count, size: "12 kB" })).toContain(
        locale === "en"
          ? `${count} offline ${count === 1 ? "copy" : "copies"}`
          : `${count} offline ${count === 1 ? "kopie" : "kopieën"}`,
      );
      expect(m.assets_imported_count({ count })).toContain(`${count} ${count === 1 ? "item" : "items"}`);
      expect(m.assets_count_visits({ count })).toBe(
        `${count} ${locale === "en" ? (count === 1 ? "visit" : "visits") : count === 1 ? "bezoek" : "bezoeken"}`,
      );
    }
  }
});

it("clears an open packing view at lease expiry and retranslates the retained expiry notice", async () => {
  const snapshot = { list: { id: "list", name: "Eigen lijst" }, bags: [], items: [], savedAt: Date.now() };
  renderWithOwner(
    <PackingOfflineView
      copy={{ id: "copy", leaseExpiresAt: Date.now() + 300 } as OfflineCopySummary}
      open={() => Promise.resolve(new Blob([JSON.stringify(snapshot)]))}
    />,
  );
  await screen.findByText("Eigen lijst");
  await screen.findByRole("alert");
  expect(screen.queryByText("Eigen lijst")).toBeNull();
  act(() => changeLocale("en"));
  expect(screen.getByRole("alert").textContent).toContain("has expired");
});

it("hides an already decrypted emergency copy immediately when the authenticated subject changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(json({ id: "entry" }))),
  );
  await pinOfflineCopy({
    subject: "owner-1",
    resourceKind: "emergency_info",
    resourceId: "entry",
    metadataUrl: "/api/library/emergency-info/entry",
    title: "Eigen contact",
    contentType: "application/json",
    bytes: new TextEncoder().encode(
      JSON.stringify({ kind: "contact", label: "Eigen contact", value: "Eigen geheime waarde" }),
    ).buffer as ArrayBuffer,
  });
  const view = renderWithOwner(<OfflineManager />);
  await screen.findByText("Eigen contact");
  fireEvent.click(screen.getByRole("button", { name: "Bekijken" }));
  await screen.findByText("Eigen geheime waarde");
  auth.session = { accessToken: testToken("other-subject") };
  view.rerender(<OfflineManager />);
  expect(screen.queryByText("Eigen geheime waarde")).toBeNull();
});

it("opens the same encrypted document bytes in both locales and still rejects another subject", async () => {
  const bytes = new TextEncoder().encode("Fictional private document").buffer as ArrayBuffer;
  const copy = await pinOfflineCopy({
    subject: "owner-1",
    resourceKind: "trip_document",
    resourceId: "document",
    metadataUrl: "/api/trips/trip/documents/document",
    title: "Eigen bestandsnaam",
    contentType: "application/pdf",
    bytes,
  });
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    const blob = await openOfflineCopy("owner-1", copy.id);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(blob.type).toBe("application/pdf");
    await expect(openOfflineCopy("other-subject", copy.id)).rejects.toThrow(
      m.assets_this_offline_copy_is_not_available_for_this_account(),
    );
  }
});

it("reopens an itinerary visit with canonical enums and authored notes in either language", () => {
  const text = JSON.stringify({
    area: { label: "Eigen gebied" },
    kind: "free",
    status: "planned",
    starts_on: "2054-09-30",
    ends_on: null,
    summary: "Eigen verhaal",
    notes: "Planned · zelf geschreven",
  });
  renderWithOwner(<OfflineSnapshotView kind="visit" text={text} />);
  expect(screen.getByText("Vrij · Gepland")).toBeTruthy();
  act(() => changeLocale("en"));
  expect(screen.getByText("Leisure · Planned")).toBeTruthy();
  expect(screen.getByText("Planned · zelf geschreven")).toBeTruthy();
  expect(screen.getByText("Eigen verhaal")).toBeTruthy();
});

it("keeps decryption diagnostics separate from retained localized offline failures", async () => {
  const copy = await pinOfflineCopy({
    subject: "owner-1",
    resourceKind: "trip_document",
    resourceId: "document",
    metadataUrl: "/api/trips/trip/documents/document",
    title: "Eigen document",
    contentType: "application/pdf",
    bytes: new TextEncoder().encode("Fictional private bytes").buffer as ArrayBuffer,
  });
  const diagnostic = new DOMException("native diagnostic", "OperationError");
  vi.spyOn(crypto.subtle, "decrypt").mockRejectedValueOnce(diagnostic);
  let failure: unknown;
  try {
    await openOfflineCopy("owner-1", copy.id);
  } catch (error) {
    failure = error;
  }
  expect((failure as Error).cause).toBe(diagnostic);
  for (const locale of ["nl", "en"] as const) {
    act(() => changeLocale(locale));
    expect((failure as Error).message).toBe(m.assets_the_offline_copy_could_not_be_opened());
    expect((failure as Error).message).not.toContain("native diagnostic");
  }
});
