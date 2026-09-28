// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithOwner, testToken } from "../query/test-utils";
import type { Trip } from "../tracker-model";
import { PackingManager } from "./PackingManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));
const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: null, ends_on: null, travel_updates: [] };
const bag = (id: string, name: string, position: number, weight_limit_g: number | null = null) => ({
  id,
  name,
  type: null,
  position,
  weight_limit_g,
});
const item = (
  id: string,
  label: string,
  bag_id: string | null,
  position: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  label,
  bag_id,
  position,
  quantity: 1,
  category: null,
  packed: false,
  weight_g: null,
  notes: null,
  essential: false,
  valuable: false,
  cabin_only: false,
  checked_only: false,
  ...extra,
});
let bags: ReturnType<typeof bag>[];
let items: ReturnType<typeof item>[];
let failToggle: boolean;
let failLists: boolean;
const calls: { method: string; url: string; body: Record<string, unknown> }[] = [];
const json = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status }));
beforeEach(() => {
  auth.session = { accessToken: testToken() };
  bags = [bag("cabin", "Handbagage", 0, 1000), bag("checked", "Ruimbagage", 1)];
  items = [
    item("a", "Sokken", "cabin", 0, { quantity: 2, category: "Kleding", weight_g: 300 }),
    item("b", "Boek", "checked", 0, { category: "Vrije tijd", packed: true }),
    item("c", "Paspoort", null, 0, { category: "Documenten", essential: true }),
  ];
  failToggle = false;
  failLists = false;
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      calls.push({ method, url, body });
      if (url.endsWith("/packing-lists") && method === "GET")
        return failLists ? json({ detail: "Oops" }, 500) : json([{ id: "list", name: "Paklijst" }]);
      if (url.endsWith("/bags") && method === "GET") return json(bags);
      if (url.endsWith("/items") && method === "GET") return json(items);
      if (url.endsWith("/bags") && method === "POST") {
        const next = bag(`new-${bags.length}`, String(body.name), bags.length);
        bags.push(next);
        return json(next, 201);
      }
      if (url.endsWith("/items") && method === "POST") {
        const next = item(`new-${items.length}`, String(body.label), body.bag_id as string | null, items.length);
        items.push(next);
        return json(next, 201);
      }
      const match = /\/items\/([^/]+)$/.exec(url);
      if (match && method === "PATCH") {
        if (failToggle && "packed" in body) {
          failToggle = false;
          return json({ detail: "Try again" }, 503);
        }
        items = items.map((row) => (row.id === match[1] ? { ...row, ...body } : row));
        return json(items.find((row) => row.id === match[1]));
      }
      throw Error(`Unexpected ${method} ${url}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("groups canonical items, filters unpacked and shows known weight", async () => {
  renderWithOwner(<PackingManager trip={trip} />);
  expect(within(await screen.findByRole("region", { name: "Niet toegewezen" })).getByText("Paspoort")).toBeTruthy();
  expect(screen.getByText(/600 g bekend/)).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Totale inpakvoortgang" }).getAttribute("value")).toBe("1");
  fireEvent.click(screen.getByRole("radio", { name: "Per categorie" }));
  expect(screen.getByRole("region", { name: "Kleding" })).toBeTruthy();
  expect(screen.getAllByText("2 × Sokken")).toHaveLength(1);
  fireEvent.click(screen.getByRole("radio", { name: "Niet ingepakt" }));
  expect(screen.queryByText("Boek")).toBeNull();
  expect(screen.getByRole("radio", { name: "Niet ingepakt" }).getAttribute("aria-checked")).toBe("true");
});

it("retains a failed toggle for retry", async () => {
  failToggle = true;
  renderWithOwner(<PackingManager trip={trip} />);
  const checkbox = await screen.findByRole("checkbox", { name: "2 × Sokken ingepakt" });
  fireEvent.click(checkbox);
  fireEvent.click(await screen.findByRole("button", { name: "Opnieuw proberen: Sokken" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Opnieuw proberen: Sokken" })).toBeNull());
  expect((checkbox as HTMLInputElement).checked).toBe(true);
});

it("moves items through edit and quick adds into a bag without order controls", async () => {
  renderWithOwner(<PackingManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Paspoort bewerken" }));
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Tas" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: "Handbagage" }));
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(items.find((row) => row.id === "c")?.bag_id).toBe("cabin"));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Naam *" })).toBeNull());
  expect(screen.queryByText("Verplaatsen")).toBeNull();
  expect(screen.queryByRole("button", { name: "Paspoort omhoog" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Handbagage omhoog" })).toBeNull();
  fireEvent.click(
    within(screen.getByRole("region", { name: "Handbagage" })).getByRole("button", { name: "Snel toevoegen" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Naam *" }), { target: { value: "Camera" } });
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  await waitFor(() =>
    expect(
      calls.some((call) => call.method === "POST" && call.body.label === "Camera" && call.body.bag_id === "cabin"),
    ).toBe(true),
  );
});

it("keeps bulk selection out of item rows until requested", async () => {
  renderWithOwner(<PackingManager trip={trip} />);
  await screen.findByRole("region", { name: "Handbagage" });
  expect(screen.queryByRole("checkbox", { name: "Selecteer Sokken" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Items selecteren" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Selecteer Sokken" }));
  expect(screen.getByText("1 geselecteerd")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Geselecteerde items verplaatsen naar" }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("option", { name: "Ruimbagage" }));
  await waitFor(() => expect(items.find((row) => row.id === "a")?.bag_id).toBe("checked"));
  expect(screen.getByText("0 geselecteerd")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Klaar" }));
  expect(screen.queryByRole("checkbox", { name: "Selecteer Sokken" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "2 × Sokken ingepakt" })).toBeTruthy();
});

it("offers retry after a load error", async () => {
  failLists = true;
  renderWithOwner(<PackingManager trip={trip} />);
  await screen.findByRole("alert");
  failLists = false;
  fireEvent.click(screen.getByRole("button", { name: "Opnieuw proberen" }));
  expect(await screen.findByRole("region", { name: "Handbagage" })).toBeTruthy();
});

it("shows loading and empty states, then adds a bag without navigation", async () => {
  items = [];
  bags = [];
  renderWithOwner(<PackingManager trip={trip} />);
  expect(screen.getByRole("status").textContent).toContain("Paklijsten laden");
  expect(await screen.findByText("Nog geen items. Voeg je eerste item toe.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Tas toevoegen" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Naam *" }), { target: { value: "Overnachtingstas" } });
  fireEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  expect(await screen.findByRole("region", { name: "Overnachtingstas" })).toBeTruthy();
});

it("marks all items unpacked and warns when known weight exceeds a limit", async () => {
  bags[0].weight_limit_g = 500;
  renderWithOwner(<PackingManager trip={trip} />);
  expect(await screen.findByText("Over de gewichtslimiet")).toBeTruthy();
  expect(screen.getByText(/gewicht niet volledig/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Alles uitpakken" }));
  await waitFor(() => expect(items.every((row) => !row.packed)).toBe(true));
});
