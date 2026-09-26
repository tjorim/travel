// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeApi, type FakeApi } from "../query/fake-api";
import { renderWithOwner, testToken } from "../query/test-utils";
import { answerConfirmation } from "../test-confirm";
import { Settings } from "./Settings";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

let api: FakeApi;
let providers: { provider: string; available: boolean; connected: boolean }[];
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  providers = [{ provider: "google_photos_picker", available: true, connected: false }, { provider: "gopro_cloud", available: true, connected: true }];
  api = fakeApi();
  api.on("GET", /^\/api\/provider-tokens$/, () => providers);
  api.on("PUT", /^\/api\/provider-tokens\/([^/]+)$/, (_body, match) => { providers = providers.map((item) => item.provider === match[1] ? { ...item, connected: true } : item); return undefined; });
  api.on("DELETE", /^\/api\/provider-tokens\/([^/]+)$/, (_body, match) => { providers = providers.map((item) => item.provider === match[1] ? { ...item, connected: false } : item); return undefined; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); });

it("asks to sign in before showing provider state", () => {
  auth.session = null;
  renderWithOwner(<Settings />);
  expect(screen.getByText("Meld aan om de status van je private mediaproviders te bekijken.")).toBeTruthy();
  expect(api.requests).toEqual([]);
});

it("shows which providers are connected", async () => {
  renderWithOwner(<Settings />);
  await screen.findByText("Google Photos");
  expect(screen.getByText("Alleen de verbindingstoestand is zichtbaar; tokens worden nooit teruggestuurd.")).toBeTruthy();
  expect(screen.getAllByText("Verbonden")).toHaveLength(1);
  expect(screen.getAllByText("Niet verbonden").length).toBeGreaterThan(0);
});

it("requires a token, connects the provider and never keeps the token", async () => {
  const { client } = renderWithOwner(<Settings />);
  await screen.findByText("Google Photos");
  fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));
  await screen.findByText("Vul een toegangstoken in om deze tijdelijke koppeling te bewaren.");
  expect(api.count("PUT /api/provider-tokens/google_photos_picker")).toBe(0);

  fireEvent.change(screen.getByLabelText(/Toegangstoken/), { target: { value: "geheim-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Verbinden" }));
  await screen.findByText("Google Photos is verbonden voor private imports. Het token is niet terug te lezen of lokaal bewaard.");
  expect(api.lastBody("PUT /api/provider-tokens/google_photos_picker")).toEqual({ access_token: "geheim-token" });
  // Both providers now show the disconnect action and no token field remains.
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Loskoppelen" })).toHaveLength(2));
  expect(screen.queryByLabelText(/Toegangstoken/)).toBeNull();
  await waitFor(() => expect(client.getMutationCache().getAll().some((mutation) => JSON.stringify(mutation.state.variables ?? "").includes("geheim-token"))).toBe(false));
  expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))).not.toContain("geheim-token");
});

it("disconnects a provider after the in-app confirmation and shows its new state", async () => {
  renderWithOwner(<Settings />);
  fireEvent.click(await screen.findByRole("button", { name: "Loskoppelen" }));
  await answerConfirmation("Loskoppelen");
  await screen.findByText("GoPro Cloud is losgekoppeld.");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Loskoppelen" })).toBeNull());
  expect(screen.getAllByRole("button", { name: "Verbinden" })).toHaveLength(2);
});

it("keeps a connected provider when the server refuses to disconnect it", async () => {
  renderWithOwner(<Settings />);
  const disconnect = await screen.findByRole("button", { name: "Loskoppelen" });
  api.failNext = { status: 500, body: { detail: "Loskoppelen mislukt." } };
  fireEvent.click(disconnect);
  await answerConfirmation("Loskoppelen");
  await screen.findByText("Loskoppelen mislukt.");
  expect(screen.getByRole("button", { name: "Loskoppelen" })).toBeTruthy();
});

it("does not list a provider the server does not offer", async () => {
  providers = [{ provider: "google_photos_picker", available: true, connected: false }, { provider: "gopro_cloud", available: false, connected: false }];
  renderWithOwner(<Settings />);
  await screen.findByText("Google Photos");
  expect(screen.queryByText("GoPro Cloud")).toBeNull();
});
