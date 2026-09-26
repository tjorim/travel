// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, resetOfflineDb, restoreObjectUrls, stubObjectUrls, testToken } from "../query/test-utils";
import type { DocumentAsset, Trip } from "../tracker-model";
import { DocumentManager } from "./DocumentManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] };
const asset = (id: string, title: string): DocumentAsset => ({ id, title, document_kind: "booking", byte_size: 512, content_type: "application/pdf", original_filename: `${id}.pdf`, created_at: "2054-01-01T00:00:00Z", file_url: `/api/trips/trip/documents/${id}/original` } as DocumentAsset);
let api: FakeApi;
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = fakeApi()
    .collection("/api/trips/trip/documents", [asset("d1", "Vliegticket"), asset("d2", "Hotelbevestiging")]);
});
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); restoreObjectUrls(); expect(api.unexpected).toEqual([]); await resetOfflineDb(); });

const pickFile = (input: Element | null, name = "bestand.pdf") => fireEvent.change(input!, { target: { files: [new File(["x"], name, { type: "application/pdf" })] } });

const openDocument = async (title: string) => fireEvent.click(await screen.findByRole("button", { name: `Document ${title} bekijken` }));

it("keeps an opened document private with no sharing controls", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await openDocument("Vliegticket");
  expect(screen.getAllByText("Vliegticket")).toHaveLength(2);
  expect(screen.queryByText("Geredigeerde afgeleiden")).toBeNull();
  expect(screen.queryByText("Expliciet goedkeuren")).toBeNull();
});

it("lists a new upload straight away", async () => {
  api.on("POST", /\/documents\/uploads$/, () => api.push("/api/trips/trip/documents", asset("d3", "Verzekering")));
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Nieuw document" }));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByText("Geef het document een titel.");
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Verzekering" } });
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByText("Kies een bestand om te uploaden.");
  expect(api.count("POST /api/trips/trip/documents/uploads")).toBe(0);

  pickFile(document.querySelector('input[type="file"]'));
  fireEvent.click(screen.getByRole("button", { name: "Document uploaden" }));
  await screen.findByRole("button", { name: "Document Verzekering bekijken" });
  const sent = api.lastBody<FormData>("POST /api/trips/trip/documents/uploads")!;
  expect(sent.get("title")).toBe("Verzekering");
  expect(sent.get("document_kind")).toBe("booking");
  expect(screen.getByText("Privédocument geüpload.")).toBeTruthy();
  expect(screen.queryByLabelText("Titel")).toBeNull();
});

it("removes a deleted document from the screen", async () => {
  renderWithOwner(<DocumentManager trip={trip} />);
  await openDocument("Vliegticket");
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Document Vliegticket bekijken" })).toBeNull());
  expect(screen.getByRole("button", { name: "Document Hotelbevestiging bekijken" })).toBeTruthy();
  expect(screen.getByText("Privédocument verwijderd.")).toBeTruthy();
  // Nothing stays open after a delete.
  expect(screen.queryByText("Geredigeerde afgeleiden")).toBeNull();
});

it("pins a document through the authenticated download and unpins it again", async () => {
  api.on("GET", /\/documents\/d1\/original$/, () => "pdf bytes");
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Vliegticket");
  fireEvent.click(screen.getAllByRole("button", { name: "Offline bewaren" })[0]);
  await screen.findByText("“Vliegticket” is offline bewaard op dit toestel.");
  const [, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([url]) => url.endsWith("/original"))!;
  expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  fireEvent.click(await screen.findByRole("button", { name: "Offline verwijderen" }));
  await screen.findByText("“Vliegticket” is niet langer offline beschikbaar.");
});

it("opens the original with the bearer token in the request, not in a link", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  stubObjectUrls("blob:original");
  api.on("GET", /\/documents\/d2\/original$/, () => "pdf");
  renderWithOwner(<DocumentManager trip={trip} />);
  await screen.findByText("Hotelbevestiging");
  fireEvent.click(screen.getAllByRole("button", { name: "Origineel bekijken" })[1]);
  await waitFor(() => expect(open).toHaveBeenCalledWith("blob:original", "_blank", "noopener"));
});
