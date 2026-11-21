import type * as Api from "@/api-schema";
// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ownerKeys } from "@/lib/query/keys";
import { fakeApi, type FakeApi } from "../query/fake-api";
import {
  chooseOption,
  renderWithOwner,
  resetOfflineDb,
  restoreObjectUrls,
  stubObjectUrls,
  testToken,
} from "../query/test-utils";
import type { DocumentAsset, Trip } from "../api-types";
import { DocumentManager } from "./DocumentManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = {
  owner_subject: "owner-1",
  content_language: "nl",
  cover_derivative_id: null,
  cover_url: null,
  summary_html: null,
  id: "trip",
  title: "Exampleland",
  title_nl: "Exampleland",
  title_en: null,
  summary: null,
  summary_nl: null,
  summary_en: null,
  starts_on: null,
  ends_on: null,
  travel_updates: [],
};
const asset = (id: string, title: string, tripId: string | null = "trip"): DocumentAsset =>
  ({
    id,
    title,
    document_kind: "booking",
    byte_size: 512,
    content_type: "application/pdf",
    original_filename: `${id}.pdf`,
    trip_id: tripId,
    created_at: "2054-01-01T00:00:00Z",
    file_url: `/api/documents/${id}/original`,
  }) as DocumentAsset;

let api: FakeApi;
let documents: DocumentAsset[];

/** The owner's one document list, served whole, filtered by trip, and changed by uploads, edits and deletes. */
function serve(initial: DocumentAsset[]) {
  documents = initial.slice();
  api = fakeApi().collection<Api.TripSummaryResponse>("/api/trips", [
    {
      owner_subject: "synthetic",
      content_language: "nl",
      title_nl: null,
      title_en: null,
      summary: null,
      summary_nl: null,
      summary_en: null,
      starts_on: null,
      ends_on: null,
      cover_derivative_id: null,
      cover_url: null,
      travel_update_count: 0,
      last_update_at: null,
      summary_html: null,
      id: "trip",
      title: "Exampleland",
    },
    {
      owner_subject: "synthetic",
      content_language: "nl",
      title_nl: null,
      title_en: null,
      summary: null,
      summary_nl: null,
      summary_en: null,
      starts_on: null,
      ends_on: null,
      cover_derivative_id: null,
      cover_url: null,
      travel_update_count: 0,
      last_update_at: null,
      summary_html: null,
      id: "other",
      title: "Elsewhere",
    },
  ]);
  api.on<Api.DocumentResponse[]>("GET", /^\/api\/documents(\?trip_id=(\w+))?$/, (_body, match) =>
    documents.filter((document) => !match[2] || document.trip_id === match[2]),
  );
  api.on<Api.DocumentResponse>("POST", /^\/api\/documents\/uploads$/, (body) => {
    const form = body as FormData;
    const created = asset(
      "d-new",
      String(form.get("title")),
      (form.get("trip_id") as string) ?? null,
    );
    documents = [...documents, created];
    return created;
  });
  api.on<Api.DocumentResponse>("PATCH", /^\/api\/documents\/(\w+)$/, (body, match) => {
    const changes = body as Partial<DocumentAsset>;
    documents = documents.map((document) =>
      document.id === match[1] ? { ...document, ...changes } : document,
    );
    return documents.find((document) => document.id === match[1]);
  });
  api.on<undefined>("DELETE", /^\/api\/documents\/(\w+)$/, (_body, match) => {
    documents = documents.filter((document) => document.id !== match[1]);
    return undefined;
  });
}

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  serve([
    asset("d1", "Vliegticket"),
    asset("d2", "Hotelbevestiging"),
    asset("d3", "Paspoort", null),
    asset("d4", "Visum", "other"),
  ]);
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreObjectUrls();
  expect(api.unexpected).toEqual([]);
  await resetOfflineDb();
});

const pickFile = (input: Element | null, name = "bestand.pdf") =>
  fireEvent.change(input!, {
    target: { files: [new File(["x"], name, { type: "application/pdf" })] },
  });

const openDocument = async (title: string) =>
  fireEvent.click(await screen.findByRole("button", { name: `Document ${title} bekijken` }));

// --- One trip's documents ---------------------------------------------------------------------

it("shows only the documents filed under the trip, private, with no sharing controls", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await openDocument("Vliegticket");
  expect(screen.getAllByText("Vliegticket")).toHaveLength(2);
  expect(screen.queryByText("Paspoort")).toBeNull();
  expect(screen.queryByText("Visum")).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Toon documenten van" })).toBeNull();
  expect(screen.queryByText("Geredigeerde afgeleiden")).toBeNull();
  expect(api.count("GET /api/documents")).toBe(0); // the trip reads only its own list
});

it("files a new upload under the trip and lists it straight away", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByText("Geef het document een titel.");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Verzekering" } });
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByText("Kies een bestand om te uploaden.");
  expect(api.count("POST /api/documents/uploads")).toBe(0);
  expect(screen.queryByRole("combobox", { name: "Reis (optioneel)" })).toBeNull();

  pickFile(document.querySelector('input[type="file"]'));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByRole("button", { name: "Document Verzekering bekijken" });
  const sent = api.lastBody<FormData>("POST /api/documents/uploads")!;
  expect(sent.get("title")).toBe("Verzekering");
  expect(sent.get("document_kind")).toBe("booking");
  expect(sent.get("trip_id")).toBe("trip");
  expect(screen.getByText("Privédocument geüpload.")).toBeTruthy();
  expect(screen.queryByLabelText("Titel")).toBeNull();
});

it("edits a document's title and kind without sending a trip", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await openDocument("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(document.querySelector('input[type="file"]')).toBeNull();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Retourticket" } });
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await screen.findByRole("button", { name: "Document Retourticket bekijken" });
  expect(api.lastBody("PATCH /api/documents/d1")).toEqual({
    title: "Retourticket",
    document_kind: "booking",
  });
  expect(screen.getByText("Document opgeslagen.")).toBeTruthy();
});

it("removes a deleted document and refreshes cached stay links before another edit", async () => {
  const { client } = renderWithOwner(<DocumentManager trip={trip} />);
  const staysKey = ownerKeys.tripResource("owner-1", trip.id, "stays");
  client.setQueryData(staysKey, [{ id: "stay-1", document_asset_ids: ["d1"] }]);
  // The stays screen is unmounted while the owner deletes a document.
  const loadStays = vi.fn(async () => [{ id: "stay-1", document_asset_ids: [] }]);
  await openDocument("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Document Vliegticket bekijken" })).toBeNull(),
  );
  expect(
    await screen.findByRole("button", { name: "Document Hotelbevestiging bekijken" }),
  ).toBeTruthy();
  expect(await screen.findByText("Privédocument verwijderd.")).toBeTruthy();
  // Returning within the cache's 30-second freshness window must reload the
  // server's detached links, otherwise the next save resubmits the deleted id.
  const stays = await client.fetchQuery({ queryKey: staysKey, queryFn: loadStays });
  expect(loadStays).toHaveBeenCalledOnce();
  expect(stays[0].document_asset_ids).toEqual([]);
  // Nothing stays open after a delete.
  expect(screen.queryByText("Geredigeerde afgeleiden")).toBeNull();
});

it("pins a document through the authenticated download and unpins it again", async () => {
  api.on<object | string>(
    /* Fixture exception: File/thumbnail transport sentinel; no JSON API record. */ "GET",
    /\/documents\/d1\/original$/,
    () => "pdf bytes",
  );
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Vliegticket");
  fireEvent.click(screen.getAllByRole("button", { name: "Offline bewaren" })[0]);
  await screen.findByText("“Vliegticket” is offline bewaard op dit toestel.");
  expect(api.lastHeaders("GET /api/documents/d1/original")?.get("authorization")).toMatch(
    /^Bearer /,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Offline verwijderen" }));
  await screen.findByText("“Vliegticket” is niet langer offline beschikbaar.");
});

it("opens the original with the bearer token in the request, not in a link", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  stubObjectUrls("blob:original");
  api.on<object | string>(
    /* Fixture exception: File/thumbnail transport sentinel; no JSON API record. */ "GET",
    /\/documents\/d2\/original$/,
    () => "pdf",
  );
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Hotelbevestiging");
  fireEvent.click(screen.getAllByRole("button", { name: "Origineel bekijken" })[1]);
  await waitFor(() => expect(open).toHaveBeenCalledWith("blob:original", "_blank", "noopener"));
});

// --- Every document, with a trip filter -------------------------------------------------------

it("lists every document with the trip it is filed under, and filters by trip", async () => {
  renderWithOwner(<DocumentManager />);
  await screen.findByText("Paspoort");
  expect(screen.getByText("Vliegticket")).toBeTruthy();
  expect(
    screen.getByText((content) => content.includes("Elsewhere"), { selector: "span" }),
  ).toBeTruthy();

  chooseOption("Toon documenten van", "Elsewhere");
  await waitFor(() => expect(screen.queryByText("Paspoort")).toBeNull());
  expect(screen.getByText("Visum")).toBeTruthy();
  expect(screen.queryByText("Vliegticket")).toBeNull();

  chooseOption("Toon documenten van", "Bij geen enkele reis");
  await screen.findByText("Paspoort");
  expect(screen.queryByText("Visum")).toBeNull();

  chooseOption("Toon documenten van", "Alle documenten");
  await screen.findByText("Visum");
  expect(screen.getByText("Vliegticket")).toBeTruthy();
});

it("shows an empty state when there are no documents", async () => {
  serve([]);
  renderWithOwner(<DocumentManager />);
  await screen.findByText(
    "Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.",
  );
});

it("uploads a document filed under a chosen trip", async () => {
  renderWithOwner(<DocumentManager />);
  await screen.findByText("Paspoort");
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Reisverzekering" } });
  fireEvent.keyDown(await screen.findByLabelText("Reis (optioneel)"), { key: "ArrowDown" });
  await screen.findByRole("option", { name: "Elsewhere" });
  chooseOption("Reis (optioneel)", "Elsewhere");
  pickFile(document.querySelector('input[type="file"]'), "polis.pdf");
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));

  await screen.findByRole("button", { name: "Document Reisverzekering bekijken" });
  expect(api.lastBody<FormData>("POST /api/documents/uploads")!.get("trip_id")).toBe("other");
  expect(screen.getByText("Privédocument geüpload.")).toBeTruthy();
  expect(screen.queryByLabelText("Titel")).toBeNull();
});

it("files an unfiled document under a trip, and unfiles it again", async () => {
  renderWithOwner(<DocumentManager />);
  await openDocument("Paspoort");
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  chooseOption("Reis (optioneel)", "Exampleland");
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("PATCH /api/documents/d3")).toEqual({
      title: "Paspoort",
      document_kind: "booking",
      trip_id: "trip",
    }),
  );
  await screen.findByText("Document opgeslagen.");

  await openDocument("Paspoort");
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  chooseOption("Reis (optioneel)", "Geen reis");
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await waitFor(() =>
    expect(api.lastBody("PATCH /api/documents/d3")).toMatchObject({ trip_id: null }),
  );
});

it("deletes a document after explicit confirmation", async () => {
  serve([asset("d3", "Paspoort", null)]);
  renderWithOwner(<DocumentManager />);
  await openDocument("Paspoort");
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }),
  );
  await screen.findByText(
    "Nog geen documenten. Upload een privébestand wanneer je het wilt bewaren.",
  );
  expect(api.count("DELETE /api/documents/d3")).toBe(1);
});

it("asks before dismissing an upload that only has a file chosen", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  // No title typed: the chosen file alone is work to lose.
  pickFile(document.querySelector('input[type="file"]'));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden sluiten" }));
  await screen.findByRole("alertdialog", { name: "Wijzigingen verwerpen?" });
  expect(screen.getByLabelText("Titel")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Wijzigingen verwerpen" }));
  await waitFor(() => expect(screen.queryByLabelText("Titel")).toBeNull());
});

it("closes an untouched upload dialog without asking", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden sluiten" }));
  await waitFor(() => expect(screen.queryByLabelText("Titel")).toBeNull());
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
