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
  window.history.replaceState(null, "", "/admin/settings");
  auth.session = { accessToken: testToken() };
  providers = [{ provider: "google_photos_picker", available: true, connected: false }, { provider: "gopro_cloud", available: false, connected: false }];
  api = fakeApi();
  api.on("GET", /^\/api\/provider-tokens$/, () => providers);
  api.on("POST", /^\/api\/provider-tokens\/google_photos_picker\/oauth\/complete$/, () => {
    providers = providers.map((item) => item.provider === "google_photos_picker" ? { ...item, connected: true } : item);
    return undefined;
  });
  api.on("DELETE", /^\/api\/provider-tokens\/([^/]+)$/, (_body, match) => { providers = providers.map((item) => item.provider === match[1] ? { ...item, connected: false } : item); return undefined; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); expect(api.unexpected).toEqual([]); });

it("asks to sign in before showing provider state", () => {
  auth.session = null;
  renderWithOwner(<Settings />);
  expect(screen.getByText("Meld aan om de status van je private mediaproviders te bekijken.")).toBeTruthy();
  expect(api.requests).toEqual([]);
});

it("hides unconfigured providers and offers Google OAuth", async () => {
  renderWithOwner(<Settings />);
  await screen.findByText("Google Photos");
  expect(screen.getByRole("button", { name: "Verbinden met Google" })).toBeTruthy();
  expect(screen.queryByText("GoPro Cloud")).toBeNull();
  expect(screen.queryByLabelText(/Toegangstoken/)).toBeNull();
});

it("hides Google when the server lacks its OAuth credentials", async () => {
  providers = [{ provider: "google_photos_picker", available: false, connected: false }, { provider: "gopro_cloud", available: false, connected: false }];
  renderWithOwner(<Settings />);
  await screen.findByText("Alleen de verbindingstoestand is zichtbaar; tokens worden nooit teruggestuurd.");
  expect(screen.queryByText("Google Photos")).toBeNull();
  expect(screen.queryByText("GoPro Cloud")).toBeNull();
});

it("completes a Google OAuth return and clears the code from the address", async () => {
  window.history.replaceState(null, "", "/admin/settings?code=authorization-code&state=one-time-state");
  renderWithOwner(<Settings />);
  await screen.findByText("Google Photos is verbonden voor private imports.");
  expect(api.lastBody("POST /api/provider-tokens/google_photos_picker/oauth/complete")).toEqual({ code: "authorization-code", state: "one-time-state" });
  expect(window.location.search).toBe("");
  await waitFor(() => expect(screen.getByRole("button", { name: "Loskoppelen" })).toBeTruthy());
  expect(api.count("PUT /api/provider-tokens/google_photos_picker")).toBe(0);
});

it("disconnects after confirmation", async () => {
  providers[0].connected = true;
  renderWithOwner(<Settings />);
  fireEvent.click(await screen.findByRole("button", { name: "Loskoppelen" }));
  await answerConfirmation("Loskoppelen");
  await screen.findByText("Google Photos is losgekoppeld.");
  await waitFor(() => expect(screen.getByRole("button", { name: "Verbinden met Google" })).toBeTruthy());
});

it("keeps the connection when revocation fails", async () => {
  providers[0].connected = true;
  renderWithOwner(<Settings />);
  fireEvent.click(await screen.findByRole("button", { name: "Loskoppelen" }));
  api.failNext = { status: 502, body: { detail: "Loskoppelen mislukt." } };
  await answerConfirmation("Loskoppelen");
  await screen.findByText("Loskoppelen mislukt.");
  expect(screen.getByRole("button", { name: "Loskoppelen" })).toBeTruthy();
});
