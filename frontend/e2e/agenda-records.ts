import type { Page } from "@playwright/test";

import { ownerTrip } from "./mock-api";

// Synthetic content only. A stateful owner API for the plan tab: what the agenda's dialogs create, change and delete
// joins the lists the agenda reads, so a check can follow a record through the whole flow.

export const area = {
  id: "area-tainan",
  visibility: "private",
  label: "Tainan",
  label_nl: "Tainan",
  label_en: null,
  region: null,
  country_code: "TW",
  latitude: 22.99,
  longitude: 120.21,
  timezone: null,
};

/** What the server does with texts sent in both languages: the plain name reads the Dutch text, else the English one. */
const resolved = (record: Record<string, unknown>) => {
  const values = { ...record };
  for (const field of ["title", "label", "summary"])
    if (`${field}_nl` in values || `${field}_en` in values)
      values[field] = values[`${field}_nl`] || values[`${field}_en`] || null;
  return values;
};

const visit = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title,
  title_nl: title,
  title_en: null,
  kind: null,
  status: "planned",
  starts_on: "2054-11-12",
  ends_on: null,
  start_time: null,
  end_time: null,
  notes: null,
  summary: null,
  notes_html: null,
  summary_html: null,
  share_time: false,
  share_date_precision: null,
  visibility: "private",
  location: null,
  area,
  possible_route_duplicates: [],
  ...overrides,
});

const stay = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  check_in_date: "2054-11-12",
  check_out_date: "2054-11-14",
  check_in_time: null,
  check_out_time: null,
  status: "planned",
  property_name: name,
  website_url: null,
  booking_reference: null,
  contact_details: null,
  notes: null,
  location: null,
  area,
  visibility: "private",
  share_date_precision: null,
  document_asset_ids: [],
  ...overrides,
});

const route = (id: string, label: string, overrides: Record<string, unknown> = {}) => ({
  id,
  mode: "train",
  label,
  label_nl: label,
  label_en: null,
  status: "planned",
  visibility: "private",
  departure_area: area,
  arrival_area: area,
  departs_on: "2054-11-13",
  departs_at: null,
  arrives_at: null,
  ...overrides,
});

export type AgendaRecords = {
  visits: Record<string, unknown>[];
  stays: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  /** Every write the page made: method, path and body. */
  writes: { method: string; path: string; body: Record<string, unknown> | null }[];
};

/** Seeds the plan tab with a few records and answers their reads and writes; call after `mockApi`. */
export async function routeAgendaRecords(
  page: Page,
  tripId: string = ownerTrip.id,
): Promise<AgendaRecords> {
  const records: AgendaRecords = {
    visits: [
      visit("visit-1", "Harbour walk"),
      visit("visit-2", "Night market", { status: "idea", starts_on: null }),
    ],
    stays: [stay("stay-1", "Hotel Aurora")],
    routes: [route("route-1", "Train to Tainan", { visibility: "everyone" })],
    writes: [],
  };
  const base = `/api/trips/${tripId}`;
  const lists = {
    visits: records.visits,
    stays: records.stays,
    routes: records.routes,
  } as const;
  await page.route(`**${base}/areas`, (request) => request.fulfill({ json: [area] }));
  for (const [resource, list] of Object.entries(lists)) {
    await page.route(`**${base}/${resource}`, async (request) => {
      const method = request.request().method();
      if (method === "GET") return request.fulfill({ json: list });
      const body = JSON.parse(request.request().postData() ?? "{}") as Record<string, unknown>;
      records.writes.push({ method, path: `${base}/${resource}`, body });
      if (method === "POST") {
        const created =
          resource === "visits"
            ? resolved(visit(`visit-${list.length + 10}`, "", body))
            : resolved({ id: `${resource}-${list.length + 10}`, ...body });
        list.push(created);
        return request.fulfill({ json: created, status: 201 });
      }
      return request.fulfill({ json: {}, status: 405 });
    });
    await page.route(`**${base}/${resource}/*`, async (request) => {
      const method = request.request().method();
      const id = new URL(request.request().url()).pathname.split("/").at(-1)!;
      const index = list.findIndex((record) => record.id === id);
      if (method === "GET") return request.fulfill({ json: list[index] });
      const body = JSON.parse(request.request().postData() ?? "{}") as Record<string, unknown>;
      records.writes.push({
        method,
        path: `${base}/${resource}/${id}`,
        body: method === "DELETE" ? null : body,
      });
      if (method === "DELETE") {
        list.splice(index, 1);
        return request.fulfill({ status: 204 });
      }
      list[index] = resolved({ ...list[index], ...body });
      return request.fulfill({ json: list[index] });
    });
  }
  // A visit's check against routes it may restate; none here.
  await page.route(`**${base}/visits/route-check`, (request) => request.fulfill({ json: [] }));
  await page.route(`**${base}/visibility/*/*`, async (request) => {
    const [kind, id] = new URL(request.request().url()).pathname.split("/").slice(-2) as [
      string,
      string,
    ];
    const body = JSON.parse(request.request().postData() ?? "{}") as { visibility: string };
    records.writes.push({
      method: request.request().method(),
      path: `${base}/visibility/${kind}/${id}`,
      body,
    });
    const list = lists[`${kind}s` as keyof typeof lists];
    const found = list.find((record) => record.id === id);
    if (found) found.visibility = body.visibility;
    return request.fulfill({ json: { visibility: body.visibility } });
  });
  return records;
}
