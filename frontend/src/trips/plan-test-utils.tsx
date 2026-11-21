import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";

import type { FakeApi } from "../query/fake-api";
import type { Trip } from "../api-types";
import { AgendaManager } from "@/features/trips/agenda/AgendaManager";
import type { CreateKind, CreatePrefill, CreateRequest } from "@/features/trips/records/create-request";
import { PlanEditors, usePlanHost } from "@/features/trips/workspace/plan-host";
import type { RecordFocus } from "@/features/trips/records/record-focus";

/**
 * The plan tab's agenda with the three record dialogs behind it, wired as `PlanSection` wires them. Tests of what an
 * editor does open it from an agenda row or the block's "New" menu, as an owner does; `createRequest` stands for a
 * start that comes from elsewhere in the workspace (the map).
 */
export function PlanHarness({
  trip,
  recordFocus = null,
  createRequest = null,
  onCreateHandled = () => undefined,
  onShowOnMap,
}: {
  trip: Trip;
  recordFocus?: RecordFocus | null;
  createRequest?: CreateRequest | null;
  onCreateHandled?: () => void;
  onShowOnMap?: (pointId: string) => void;
}) {
  // The agenda's own starts ("New", a day's "Add") travel as the workspace's do: one pending request.
  const [own, setOwn] = useState<CreateRequest | null>(null);
  const [count, setCount] = useState(0);
  const start = (kind: CreateKind, prefill: CreatePrefill, returnTo: HTMLElement | null = null) => {
    setOwn({ kind, prefill, token: count + 1, returnTo });
    setCount(count + 1);
  };
  const host = usePlanHost(recordFocus, own ?? createRequest, () =>
    own ? setOwn(null) : onCreateHandled(),
  );
  return (
    <>
      <AgendaManager trip={trip} host={host} onShowOnMap={onShowOnMap} onCreateRecord={start} />
      <PlanEditors trip={trip} host={host} />
    </>
  );
}

/** What the agenda and its dialogs read besides the records a test is about, as empty lists. */
export function ensurePlanApi(api: FakeApi): FakeApi {
  return api.ensure(
    "/api/trips/trip/visits",
    "/api/trips/trip/stays",
    "/api/trips/trip/routes",
    "/api/trips/trip/areas",
    "/api/trips/trip/locations",
    "/api/documents?trip_id=trip",
  );
}

const withoutTime = (name: string) => name.replace(/^\d\d:\d\d /, "");

/** The row button of a record: "Bezoek: Tainan …", "Verblijf: Hotel …" or "Route: Taipei → Tainan …". */
export const agendaRow = (label: string) =>
  screen.findByRole("button", { name: (name) => withoutTime(name).startsWith(label) });
export const getAgendaRow = (label: string) =>
  screen.getByRole("button", { name: (name) => withoutTime(name).startsWith(label) });
export const queryAgendaRow = (label: string) =>
  screen.queryByRole("button", { name: (name) => withoutTime(name).startsWith(label) });

/** Starts a new record from the block's "Nieuw" menu: its item names the kind ("Nieuw bezoek"). */
export async function startNew(item: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Nieuw" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
}

/** Opens a row's menu ("Acties voor …") and returns it for `within`. */
export async function openRowMenu(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Acties voor ${title}` }));
  return within(await screen.findByRole("menu"));
}
