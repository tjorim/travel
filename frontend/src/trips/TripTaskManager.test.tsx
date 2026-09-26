// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithOwner, testToken } from "../query/test-utils";
import type { Stay, Route, Trip, TripTask, TripTaskAlert } from "../tracker-model";
import { TripOverview } from "./TripOverview";
import { TripTaskManager } from "./TripTaskManager";

const auth = vi.hoisted(() => ({ session: null as { accessToken: string } | null }));
vi.mock("../auth-context", () => ({ useAuth: () => auth }));

const trip: Trip = { id: "trip", title: "Exampleland", summary: null, starts_on: "2054-11-16", ends_on: null, travel_updates: [] };
const task = (id: string, title: string, extra: Partial<TripTask> = {}): TripTask => ({ id, title, notes: null, due_date: null, remind_at: null, reminded_at: null, links: [], completed_at: null, created_at: "2054-09-01T00:00:00Z", ...extra });

type Api = { tasks: TripTask[]; alerts: TripTaskAlert[]; failNext: { status: number; body: unknown } | null; requests: string[] };
let api: Api;

function json(value: unknown, status = 200) { return Promise.resolve(new Response(JSON.stringify(value), { status })); }

beforeEach(() => {
  auth.session = { accessToken: testToken() };
  api = { tasks: [task("a", "Visum regelen"), task("b", "Reisverzekering")], alerts: [], failNext: null, requests: [] };
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    api.requests.push(`${method} ${url}`);
    if (method !== "GET" && api.failNext) { const failure = api.failNext; api.failNext = null; return json(failure.body, failure.status); }
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.endsWith("/stays")) return json([] as Stay[]);
    if (url.endsWith("/routes")) return json([] as Route[]);
    if (url.endsWith("/task-alerts")) return json(api.alerts);
    if (url.endsWith("/trip-tasks") && method === "GET") return json(api.tasks);
    if (url.endsWith("/trip-tasks") && method === "POST") { const created = task(`new-${api.tasks.length}`, String(body.title), { notes: (body.notes as string | null) ?? null }); api.tasks = [...api.tasks, created]; return json(created, 201); }
    const match = /trip-tasks\/([^/]+)$/.exec(url);
    if (match && method === "PATCH") { api.tasks = api.tasks.map((item) => item.id === match[1] ? { ...item, ...("title" in body ? { title: String(body.title) } : {}), ...("completed" in body ? { completed_at: body.completed ? "2054-09-24T10:00:00Z" : null } : {}) } : item); return json(api.tasks.find((item) => item.id === match[1])); }
    if (match && method === "DELETE") { api.tasks = api.tasks.filter((item) => item.id !== match[1]); return Promise.resolve(new Response(null, { status: 204 })); }
    throw new Error(`unexpected request ${method} ${url}`);
  }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const openTask = async (title: string) => fireEvent.click(await screen.findByRole("button", { name: `Taak ${title} bekijken` }));

it("shows the edited title straight after saving, without a reload", async () => {
  renderWithOwner(<TripTaskManager trip={trip} />);
  await openTask("Visum regelen");
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Visum aanvragen" } });
  fireEvent.click(screen.getByRole("button", { name: "Taak opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "Taak Visum aanvragen bekijken" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Taak Visum regelen bekijken" })).toBeNull();
  expect(screen.getByText("Taak opgeslagen.")).toBeTruthy();
});

it("opens the editor with the saved task instead of a blank form", async () => {
  api.tasks = [task("a", "Visum regelen", { notes: "Bij de ambassade", due_date: "2054-10-01", links: [{ label: "Ambassade", url: "https://example.test" }] })];
  renderWithOwner(<TripTaskManager trip={trip} />);
  await openTask("Visum regelen");
  fireEvent.click(screen.getByRole("button", { name: "Bewerken" }));
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Visum regelen");
  expect((screen.getByLabelText("Notities (optioneel)") as HTMLTextAreaElement).value).toBe("Bij de ambassade");
  expect((screen.getByLabelText("Deadline (optioneel)") as HTMLInputElement).value).toBe("2054-10-01");
  expect((screen.getByLabelText("Adres") as HTMLInputElement).value).toBe("https://example.test");
});

it("removes a deleted task at once and after the refetch", async () => {
  renderWithOwner(<TripTaskManager trip={trip} />);
  await openTask("Reisverzekering");
  fireEvent.click(screen.getByRole("button", { name: "Verwijderen" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Verwijderen" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Taak Reisverzekering bekijken" })).toBeNull());
  expect(screen.getByText("Taak verwijderd.")).toBeTruthy();
  expect(api.tasks.map((item) => item.id)).toEqual(["a"]);
});

it("restores a task when completing it is refused", async () => {
  renderWithOwner(<TripTaskManager trip={trip} />);
  await screen.findByRole("button", { name: "Taak Visum regelen bekijken" });
  api.failNext = { status: 500, body: { detail: "Opslaan mislukt op de server." } };
  fireEvent.click(screen.getAllByRole("button", { name: "Afvinken" })[0]);
  await screen.findByText("Opslaan mislukt op de server.");
  expect(screen.getAllByRole("button", { name: "Afvinken" })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Heropenen" })).toBeNull();
});

it("refreshes the overview badge when a task is completed elsewhere on the screen", async () => {
  renderWithOwner(<><TripOverview trip={trip} /><TripTaskManager trip={trip} /></>);
  await screen.findByText("2 open");
  fireEvent.click(screen.getAllByRole("button", { name: "Afvinken" })[0]);
  await screen.findByText("1 open");
  // One shared read per resource: overview and manager never fetch the tasks twice.
  expect(api.requests.filter((request) => request === "GET /api/trips/trip/trip-tasks").length).toBeLessThanOrEqual(2);
});

it("validates the form, keeps the editor open on a server error, and resets after success", async () => {
  renderWithOwner(<TripTaskManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe taak" }));
  const save = screen.getByRole("button", { name: "Taak toevoegen", description: "" }) as HTMLButtonElement;

  fireEvent.click(save);
  const title = await screen.findByLabelText("Titel");
  await waitFor(() => expect(title.getAttribute("aria-invalid")).toBe("true"));
  expect(screen.getByRole("alert").textContent).toBe("Geef de taak een titel.");
  expect(document.activeElement).toBe(title);
  expect(title.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);

  fireEvent.change(title, { target: { value: "Vliegtickets" } });
  await waitFor(() => expect(title.getAttribute("aria-invalid")).toBeNull());

  api.failNext = { status: 422, body: { detail: [{ loc: ["body", "title"], msg: "Deze titel bestaat al." }] } };
  fireEvent.click(save);
  await screen.findByText("Deze titel bestaat al.", { selector: ".field-error" });
  expect(screen.getByRole("heading", { name: "Taak toevoegen" })).toBeTruthy();
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Vliegtickets");
  expect(save.disabled).toBe(false);

  fireEvent.change(title, { target: { value: "Vliegtickets boeken" } });
  await waitFor(() => expect(screen.queryByText("Deze titel bestaat al.", { selector: ".field-error" })).toBeNull());
  fireEvent.click(save);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("button", { name: "Taak Vliegtickets boeken bekijken" })).toBeTruthy();

  // A new editor opens blank, not with the previous values.
  fireEvent.click(screen.getByRole("button", { name: "Nieuwe taak" }));
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("");
});

it("disables submit while saving and asks before discarding a dirty form", async () => {
  let release: () => void = () => undefined;
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => init.method === "POST" ? new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify(task("z", "Nieuw")), { status: 201 })); }) : original(url, init)));
  renderWithOwner(<TripTaskManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe taak" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Nieuw" } });
  fireEvent.click(screen.getByRole("button", { name: "Taak toevoegen sluiten" }));
  expect(screen.getByRole("heading", { name: "Wijzigingen verwerpen?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Verder bewerken" }));

  fireEvent.click(screen.getByRole("button", { name: "Taak toevoegen" }));
  const busy = await screen.findByRole("button", { name: "Opslaan…" }) as HTMLButtonElement;
  expect(busy.disabled).toBe(true);
  release();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("requires a name and an https address for each link", async () => {
  renderWithOwner(<TripTaskManager trip={trip} />);
  fireEvent.click(await screen.findByRole("button", { name: "Nieuwe taak" }));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Boeken" } });
  fireEvent.click(screen.getByRole("button", { name: "Link toevoegen" }));
  fireEvent.change(screen.getByLabelText("Naam"), { target: { value: "Site" } });
  fireEvent.change(screen.getByLabelText("Adres"), { target: { value: "http://example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Taak toevoegen" }));
  await screen.findByText("Gebruik een https-adres.");
  expect(api.requests.some((request) => request.startsWith("POST"))).toBe(false);
});
