import { useLocale, formatNumber } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, textNotice } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { TravelTextarea } from "../ui/TravelTextarea";
import { Input } from "@base-ui/react/input";
import { Progress } from "@base-ui/react/progress";
import { Button } from "@base-ui/react/button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RecordDialog, DeleteConfirmation } from "../RecordDialog";
import { useOwner, tripPath } from "../query/owner-queries";
import { ownerRequest, errorMessage } from "../query/api";
import type { Trip } from "../tracker-model";
import { ChoiceGroup } from "../ui/ChoiceGroup";
import { SearchSelect } from "../forms/fields";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { PackingOfflineView, type PackingSnapshot } from "./PackingOfflineView";
import { Field, FieldLabel, FieldSet, FieldLegend } from "../ui/field";

type PackingList = { id: string; name: string };
type PackingSource = PackingList & { trip_id: string; trip_title: string };
type PackingTemplate = PackingList;
type PackingSuggestion = {
  label: string;
  category: string | null;
  prior_trips: number;
  usually_cabin: boolean;
  usually_essential: boolean;
};
type Bag = { id: string; name: string; type: string | null; position: number; weight_limit_g: number | null };
type Item = {
  id: string;
  label: string;
  quantity: number;
  category: string | null;
  bag_id: string | null;
  position: number;
  packed: boolean;
  weight_g: number | null;
  notes: string | null;
  essential: boolean;
  last_minute: boolean;
  valuable: boolean;
  cabin_only: boolean;
  checked_only: boolean;
};
type ItemDraft = Omit<Item, "id" | "position" | "packed">;
type BagDraft = Pick<Bag, "name" | "type" | "weight_limit_g">;
type Group = "bag" | "category";
type Filter = "all" | "unpacked" | "packed" | "last-minute";
const emptyItem = (bag_id: string | null): ItemDraft => ({
  label: "",
  quantity: 1,
  category: null,
  bag_id,
  weight_g: null,
  notes: null,
  essential: false,
  last_minute: false,
  valuable: false,
  cabin_only: false,
  checked_only: false,
});
const emptyBag = (): BagDraft => ({ name: "", type: null, weight_limit_g: null });
const ordered = <T extends { position: number; id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
const grams = (value: number) =>
  value >= 1000 ? `${formatNumber(value / 1000, { maximumFractionDigits: 2 })} kg` : `${formatNumber(value)} g`;
const count = (rows: Item[]) => {
  const packed = rows.filter((item) => item.packed).length;
  return m.assets_of_packed_to_go({ p0: packed, p1: rows.length, p2: rows.length - packed });
};
function PackingProgress({ rows, label }: { rows: Item[]; label: string }) {
  useLocale();
  return (
    <Progress.Root
      aria-label={label}
      value={rows.filter((item) => item.packed).length}
      max={Math.max(rows.length, 1)}
      className="block w-full"
    >
      <Progress.Track className="block h-2 overflow-hidden rounded-full bg-travel-tint">
        <Progress.Indicator className="h-full rounded-full bg-travel-forest" />
      </Progress.Track>
    </Progress.Root>
  );
}
const bagTypes = () =>
  [
    ["cabin", m.assets_cabin_baggage()],
    ["checked", m.assets_checked_baggage()],
    ["day", m.assets_day_or_overnight_bag()],
    ["person", m.assets_on_your_person()],
    ["other", m.assets_other()],
  ] as const;

export function PackingManager({ trip }: { trip: Trip }) {
  const locale = useLocale();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const client = useQueryClient();
  const base = tripPath(trip.id, "packing-lists");
  const key = ["owner", owner?.subject, "trip", trip.id, "packing"];
  const listsQuery = useQuery({
    queryKey: [...key, "lists"],
    enabled: !!owner,
    queryFn: () => ownerRequest<PackingList[]>(owner!.session, base, m.assets_loading_packing_lists_failed),
  });
  const [chosenList, setChosenList] = useState<string | null>(null);
  const list = listsQuery.data?.find((row) => row.id === chosenList) ?? listsQuery.data?.[0] ?? null;
  const path = list ? `${base}/${encodeURIComponent(list.id)}` : "";
  const bagsQuery = useQuery({
    queryKey: [...key, list?.id, "bags"],
    enabled: !!owner && !!list,
    queryFn: () => ownerRequest<Bag[]>(owner!.session, `${path}/bags`, m.assets_loading_bags_failed),
  });
  const itemsQuery = useQuery({
    queryKey: [...key, list?.id, "items"],
    enabled: !!owner && !!list,
    queryFn: () => ownerRequest<Item[]>(owner!.session, `${path}/items`, m.assets_loading_packing_items_failed),
  });
  const [group, setGroup] = useState<Group>("bag");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [itemDialog, setItemDialog] = useState<string | "new" | null>(null);
  const [bagDialog, setBagDialog] = useState<string | "new" | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItem(null));
  const [bagDraft, setBagDraft] = useState<BagDraft>(emptyBag);
  const [confirm, setConfirm] = useState<{ kind: "item" | "bag"; id: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useFeedback<string>("");
  const [reuseOpen, setReuseOpen] = useState(false);
  const [reuseMode, setReuseMode] = useState<"copy" | "templates">("copy");
  const [sourceId, setSourceId] = useState("");
  const [templateIds, setTemplateIds] = useState<string[]>([]);
  const [reuseName, setReuseName] = useState<string>(() => m.assets_packing_list());
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [leavingSoon, setLeavingSoon] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const sourcesQuery = useQuery({
    queryKey: [...key, "sources"],
    enabled: !!owner && reuseOpen,
    queryFn: () =>
      ownerRequest<PackingSource[]>(owner!.session, "/api/packing-list-sources", m.assets_loading_source_lists_failed),
  });
  const templatesQuery = useQuery({
    queryKey: [...key, "templates"],
    enabled: !!owner && reuseOpen,
    queryFn: () =>
      ownerRequest<PackingTemplate[]>(owner!.session, "/api/packing-templates", m.assets_loading_templates_failed),
  });
  const suggestionsQuery = useQuery({
    queryKey: [...key, list?.id, "suggestions"],
    enabled: !!owner && !!list && showSuggestions,
    queryFn: () =>
      ownerRequest<PackingSuggestion[]>(owner!.session, `${path}/suggestions`, m.assets_loading_suggestions_failed),
  });
  // Failed toggles remain visible at the requested state until the owner retries or reloads.
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const bags = ordered(bagsQuery.data ?? []);
  const serverItems = itemsQuery.data ?? [];
  const items = serverItems.map((item) => (item.id in unsaved ? { ...item, packed: unsaved[item.id] } : item));
  const visible = ordered(items).filter(
    (item) =>
      (filter === "all" || (filter === "last-minute" ? item.last_minute : item.packed === (filter === "packed"))) &&
      `${item.label} ${item.category ?? ""} ${item.notes ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: [...key, "lists"] }),
      client.invalidateQueries({ queryKey: [...key, list?.id, "bags"] }),
      client.invalidateQueries({ queryKey: [...key, list?.id, "items"] }),
      client.invalidateQueries({ queryKey: [...key, list?.id, "suggestions"] }),
    ]);
  };
  const request = <T,>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) =>
    ownerRequest<T>(owner!.session, url, m.assets_saving_failed, { method, body });
  async function save(action: () => Promise<unknown>, success: () => string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(textNotice(success));
      return true;
    } catch (error) {
      // A multi-item action may have saved some rows before one request failed.
      await refresh().catch(() => undefined);
      setNotice(errorNotice(error, m.assets_saving_failed_try_again));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function toggle(item: Item, packed = !item.packed) {
    if (savingIds.includes(item.id)) return;
    setUnsaved((current) => ({ ...current, [item.id]: packed }));
    setSavingIds((current) => [...current, item.id]);
    setNotice("");
    try {
      const saved = await request<Item>(`${path}/items/${encodeURIComponent(item.id)}`, "PATCH", { packed });
      client.setQueryData<Item[]>([...key, list?.id, "items"], (rows) =>
        rows?.map((row) => (row.id === item.id ? saved : row)),
      );
      setUnsaved((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      setNotice(errorNotice(error, m.assets_checking_off_failed, () => m.api_packing_retry()));
    } finally {
      setSavingIds((current) => current.filter((id) => id !== item.id));
    }
  }
  const startItem = (item?: Item, bagId: string | null = null) => {
    setItemDraft(
      item
        ? {
            label: item.label,
            quantity: item.quantity,
            category: item.category,
            bag_id: item.bag_id,
            weight_g: item.weight_g,
            notes: item.notes,
            essential: item.essential,
            last_minute: item.last_minute,
            valuable: item.valuable,
            cabin_only: item.cabin_only,
            checked_only: item.checked_only,
          }
        : emptyItem(bagId),
    );
    setItemDialog(item?.id ?? "new");
  };
  const startBag = (bag?: Bag) => {
    setBagDraft(bag ? { name: bag.name, type: bag.type, weight_limit_g: bag.weight_limit_g } : emptyBag());
    setBagDialog(bag?.id ?? "new");
  };
  async function bulk(packed?: boolean, bagId?: string | null, all = false) {
    const targets = items.filter((item) => all || selected.includes(item.id));
    if (!targets.length) return;
    const ok = await save(
      async () => {
        for (const item of targets)
          await request(
            `${path}/items/${encodeURIComponent(item.id)}`,
            "PATCH",
            packed === undefined ? { bag_id: bagId } : { packed },
          );
      },
      () => m.assets_items_updated({ count: targets.length }),
    );
    if (ok) setSelected([]);
  }
  const sections =
    group === "bag"
      ? [
          ...bags.map((bag) => ({ id: bag.id, title: bag.name, bag })),
          { id: "unassigned", title: m.assets_unassigned(), bag: null },
        ]
      : [...new Set(visible.map((item) => item.category?.trim() || ""))]
          .sort((a, b) => a.localeCompare(b, locale))
          .map((category) => ({ id: category, title: category || m.assets_uncategorised(), bag: null }));
  const unpackedEssentials = items.filter((item) => item.essential && !item.packed);
  const unpackedLastMinute = items.filter((item) => item.last_minute && !item.packed);
  const unassigned = items.filter((item) => !item.bag_id);
  const conflicts = items.filter((item) => {
    const type = bags.find((bag) => bag.id === item.bag_id)?.type;
    return (item.cabin_only && type === "checked") || (item.checked_only && type === "cabin");
  });
  const overweight = bags.filter(
    (bag) =>
      bag.weight_limit_g !== null &&
      items
        .filter((item) => item.bag_id === bag.id)
        .reduce((sum, item) => sum + (item.weight_g ?? 0) * item.quantity, 0) > bag.weight_limit_g,
  );

  const savedCopies = offline.copies.filter(
    (copy) => copy.resourceKind === "packing_list" && copy.metadataUrl.startsWith(`${base}/`),
  );
  const savedCopy = savedCopies.find((copy) => copy.resourceId === chosenList) ?? savedCopies[0];
  const showingCopy = !offline.online || listsQuery.isError || (list && (bagsQuery.isError || itemsQuery.isError));
  async function saveOfflineCopy() {
    if (!owner || !list || !offline.online) return;
    setBusy(true);
    setNotice("");
    try {
      const [freshList, freshBags, freshItems] = await Promise.all([
        ownerRequest<PackingList>(owner.session, path, m.assets_loading_packing_list_failed),
        ownerRequest<Bag[]>(owner.session, `${path}/bags`, m.assets_loading_bags_failed),
        ownerRequest<Item[]>(owner.session, `${path}/items`, m.assets_loading_packing_items_failed),
      ]);
      const snapshot: PackingSnapshot = {
        list: freshList,
        bags: freshBags,
        items: freshItems,
        savedAt: Date.now(),
      };
      await offline.pin({
        resourceKind: "packing_list",
        resourceId: list.id,
        metadataUrl: path,
        title: `${trip.title} · ${freshList.name}`,
        contentType: "application/json",
        bytes: new TextEncoder().encode(JSON.stringify(snapshot)).buffer as ArrayBuffer,
      });
      setNotice(textNotice(() => m.assets_packing_list_saved_offline_on_this_device_changes_require_a_connection()));
    } catch (error) {
      setNotice(errorNotice(error, m.assets_the_packing_list_could_not_be_saved_offline));
    } finally {
      setBusy(false);
    }
  }
  async function removeOfflineCopy() {
    if (!list) return;
    await offline.removeByResource("packing_list", list.id);
    setNotice(textNotice(() => m.assets_packing_list_is_no_longer_available_offline()));
  }

  if (showingCopy)
    return (
      <section className="space-y-4" aria-labelledby="packing-title">
        <h3 id="packing-title" className="text-2xl font-semibold">
          {m.owner_packing()}
        </h3>
        {savedCopies.length > 1 && (
          <Field>
            <FieldLabel className="block">{m.assets_offline_packing_list()} </FieldLabel>
            <SearchSelect
              ariaLabel={m.assets_offline_packing_list()}
              value={savedCopy?.resourceId ?? ""}
              onChange={setChosenList}
            >
              {savedCopies.map((copy) => (
                <option key={copy.id} value={copy.resourceId}>
                  {copy.title}
                </option>
              ))}
            </SearchSelect>
          </Field>
        )}
        {savedCopy ? (
          <PackingOfflineView copy={savedCopy} open={offline.open} />
        ) : (
          <p role={offline.online ? "alert" : "status"}>
            {offline.online && listsQuery.isError
              ? errorMessage(listsQuery.error, m.assets_loading_packing_lists_failed)
              : offline.online && (bagsQuery.isError || itemsQuery.isError)
                ? m.assets_loading_packing_list_failed_2()
                : offline.loaded
                  ? m.assets_no_offline_packing_list_saved_for_this_trip_reconnect_to_save_one()
                  : m.assets_loading_offline_packing_lists()}
          </p>
        )}
        {offline.online && (
          <Button type="button" onClick={() => void refresh()}>
            {m.retry()}
          </Button>
        )}
      </section>
    );

  if (listsQuery.isPending)
    return (
      <section className="rounded-xl border p-5" role="status">
        {m.assets_loading_packing_lists()}
      </section>
    );
  return (
    <section className="travel-card space-y-5" aria-labelledby="packing-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="packing-title" className="text-2xl font-semibold">
            {m.owner_packing()}
          </h3>
          <p className="text-sm">{m.assets_only_for_you_line({ p0: count(items) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {list && (
            <Button className="secondary compact" type="button" onClick={() => startBag()}>
              {m.assets_add_bag()}
            </Button>
          )}
          {list && (
            <Button className="compact" type="button" onClick={() => startItem()}>
              {m.assets_add_item()}
            </Button>
          )}
          <Button
            className="secondary compact"
            type="button"
            onClick={() => {
              setReuseName(m.assets_packing_list());
              setReuseOpen(true);
            }}
          >
            {m.assets_reuse_list()}
          </Button>
          {list && (
            <Button className="secondary compact" type="button" onClick={() => setTemplateName(list.name)}>
              {m.assets_save_as_template()}
            </Button>
          )}
          {list && (
            <Button className="secondary compact" type="button" onClick={() => setShowSuggestions(!showSuggestions)}>
              {m.assets_suggestions_from_earlier_trips()}
            </Button>
          )}
          {list && (
            <Button
              className="secondary compact"
              type="button"
              disabled={busy || offline.unsupported || !offline.online}
              onClick={() => void saveOfflineCopy()}
            >
              {offline.isPinned("packing_list", list.id) ? m.assets_refresh_offline_copy() : m.owner_save_offline()}
            </Button>
          )}
          {list && offline.isPinned("packing_list", list.id) && (
            <Button className="secondary compact" type="button" onClick={() => void removeOfflineCopy()}>
              {m.owner_remove_offline_copy()}
            </Button>
          )}
        </div>
      </div>
      {list && offline.isPinned("packing_list", list.id) && (
        <p className="text-sm">{m.assets_an_offline_copy_has_been_saved_refresh_after_changes_to_take_the_latest_()}</p>
      )}
      {!list ? (
        <div className="rounded-xl border p-5">
          <p>{m.assets_no_packing_list_for_this_trip_yet()}</p>
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void save(
                () => request(base, "POST", { name: m.assets_packing_list() }),
                () => m.assets_packing_list_created(),
              )
            }
          >
            {m.assets_create_packing_list()}
          </Button>
        </div>
      ) : (
        <>
          {(listsQuery.data?.length ?? 0) > 1 && (
            <Field>
              <FieldLabel className="block">{m.assets_packing_list()} </FieldLabel>
              <SearchSelect
                ariaLabel={m.assets_packing_list()}
                value={list.id}
                onChange={(value) => {
                  setChosenList(value);
                  setSelected([]);
                  setSelecting(false);
                  setUnsaved({});
                }}
              >
                {listsQuery.data?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </SearchSelect>
            </Field>
          )}
          {bagsQuery.isPending || itemsQuery.isPending ? (
            <p role="status">{m.assets_loading_packing_list()}</p>
          ) : bagsQuery.isError || itemsQuery.isError ? (
            <div role="alert">
              {m.assets_loading_packing_list_failed_2()}{" "}
              <Button type="button" onClick={() => void refresh()}>
                {m.retry()}
              </Button>
            </div>
          ) : (
            <>
              <PackingProgress rows={items} label={m.assets_overall_packing_progress()} />
              {showSuggestions && (
                <section
                  aria-label={m.assets_suggestions_from_earlier_trips()}
                  className="space-y-2 rounded-xl border p-4"
                >
                  <h4 className="font-semibold">{m.assets_you_might_want_to_bring()}</h4>
                  {suggestionsQuery.isPending && <p>{m.assets_loading_suggestions()}</p>}
                  {suggestionsQuery.isError && (
                    <p role="alert">
                      {m.assets_loading_suggestions_failed()}{" "}
                      <Button type="button" onClick={() => void suggestionsQuery.refetch()}>
                        {m.retry()}
                      </Button>
                    </p>
                  )}
                  {suggestionsQuery.data
                    ?.filter((suggestion) => !dismissedSuggestions.includes(`${list.id}:${suggestion.label}`))
                    .map((suggestion) => (
                      <div key={suggestion.label} className="flex flex-wrap items-center gap-2 border-t py-2">
                        <p className="flex-1">
                          {m.assets_suggestion_summary({
                            name: suggestion.label,
                            trips: m.assets_prior_trips({ count: suggestion.prior_trips }),
                            cabin: suggestion.usually_cabin ? m.assets_usually_in_cabin_baggage() : "",
                            essential: suggestion.usually_essential ? m.assets_usually_essential() : "",
                          })}
                        </p>
                        <Button
                          type="button"
                          className="secondary compact"
                          onClick={() => {
                            setItemDraft({
                              ...emptyItem(null),
                              label: suggestion.label,
                              category: suggestion.category,
                              essential: suggestion.usually_essential,
                            });
                            setItemDialog("new");
                          }}
                        >
                          {m.assets_add()}
                        </Button>
                        <Button
                          type="button"
                          className="secondary compact"
                          onClick={() =>
                            setDismissedSuggestions((current) => [...current, `${list.id}:${suggestion.label}`])
                          }
                        >
                          {m.assets_dismiss()}
                        </Button>
                      </div>
                    ))}
                  {suggestionsQuery.data?.length === 0 && <p>{m.assets_no_recurring_items_to_suggest_yet()}</p>}
                </section>
              )}
              <Button
                type="button"
                className="secondary compact"
                aria-expanded={leavingSoon}
                onClick={() => setLeavingSoon(!leavingSoon)}
              >
                {m.assets_departure_check()}
              </Button>
              {leavingSoon && (
                <section aria-label={m.assets_departure_check()} className="space-y-3 rounded-xl border p-4">
                  <h4 className="text-lg font-semibold">{m.assets_departure_check()}</h4>
                  <p>{count(items)}</p>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {bags.map((bag) => {
                      const rows = items.filter((item) => item.bag_id === bag.id);
                      const known = rows.reduce((sum, item) => sum + (item.weight_g ?? 0) * item.quantity, 0);
                      return (
                        <li key={bag.id}>
                          {m.assets_known_line({
                            p0: bag.name,
                            p1: count(rows),
                            p2: grams(known),
                            p3: bag.weight_limit_g ? m.assets_limit({ p0: grams(bag.weight_limit_g) }) : "",
                            p4: rows.some((item) => item.weight_g === null) ? m.assets_weight_incomplete() : "",
                          })}
                        </li>
                      );
                    })}
                  </ul>
                  {items.length > 0 &&
                    !unpackedEssentials.length &&
                    !unpackedLastMinute.length &&
                    !unassigned.length &&
                    !conflicts.length &&
                    !overweight.length && <p className="font-semibold">{m.assets_ready_to_leave()}</p>}
                  {!!unpackedEssentials.length && (
                    <p>
                      {m.assets_essential_still_to_pack_line({
                        p0: unpackedEssentials.map((item) => item.label).join(", "),
                      })}
                    </p>
                  )}
                  {!!unpackedLastMinute.length && (
                    <p>
                      {m.assets_on_departure_day_line({ p0: unpackedLastMinute.map((item) => item.label).join(", ") })}
                    </p>
                  )}
                  {!!unassigned.length && (
                    <p>{m.assets_still_without_a_bag_line({ p0: unassigned.map((item) => item.label).join(", ") })}</p>
                  )}
                  {!!overweight.length && (
                    <p>
                      {m.assets_known_weight_above_the_set_limit_unknown_weights_are_not_included_line({
                        p0: overweight.map((bag) => bag.name).join(", "),
                      })}
                    </p>
                  )}
                  {!!conflicts.length && (
                    <p>
                      {m.assets_check_your_own_baggage_choice_line({
                        p0: conflicts.map((item) => item.label).join(", "),
                      })}
                    </p>
                  )}
                  <p className="text-sm">{m.assets_baggage_flags_are_your_own_notes_not_official_travel_rules()}</p>
                </section>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label={m.assets_progress_per_bag()}>
                {bags.map((bag) => {
                  const rows = items.filter((item) => item.bag_id === bag.id);
                  const known = rows.reduce((sum, item) => sum + (item.weight_g ?? 0) * item.quantity, 0);
                  const unknown = rows.some((item) => item.weight_g === null);
                  return (
                    <div key={bag.id} className="rounded-xl border p-3">
                      <strong>{bag.name}</strong>
                      {bag.type && (
                        <p className="text-sm">{bagTypes().find(([type]) => type === bag.type)?.[1] ?? bag.type}</p>
                      )}
                      <p>{count(rows)}</p>
                      <PackingProgress rows={rows} label={m.assets_packing_progress({ p0: bag.name })} />
                      <p>
                        {m.assets_known_line_2({
                          p0: grams(known),
                          p1: unknown ? m.assets_weight_incomplete() : "",
                          p2: bag.weight_limit_g ? m.assets_limit({ p0: grams(bag.weight_limit_g) }) : "",
                        })}
                      </p>
                      {bag.weight_limit_g !== null && known > bag.weight_limit_g && (
                        <p role="alert" className="font-bold text-travel-danger!">
                          {m.assets_over_the_weight_limit()}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 rounded-xl border p-3">
                <ChoiceGroup<Group>
                  label={m.assets_group()}
                  value={group}
                  choices={[
                    { value: "bag", label: m.assets_by_bag() },
                    { value: "category", label: m.assets_by_category() },
                  ]}
                  onChange={setGroup}
                />
                <ChoiceGroup<Filter>
                  label={m.assets_show()}
                  value={filter}
                  choices={[
                    { value: "all", label: m.assets_all() },
                    { value: "unpacked", label: m.assets_unpacked() },
                    { value: "packed", label: m.assets_packed() },
                    { value: "last-minute", label: m.assets_departure_day() },
                  ]}
                  onChange={setFilter}
                />
                <Field className="contents">
                  <FieldLabel>
                    {m.owner_search()}{" "}
                    <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
                  </FieldLabel>
                </Field>
              </div>
              {selecting && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                  <span>{m.assets_selected_line({ p0: selected.length })}</span>
                  <Button type="button" disabled={busy || !selected.length} onClick={() => void bulk(true)}>
                    {m.owner_packing()}
                  </Button>
                  <Button type="button" disabled={busy || !selected.length} onClick={() => void bulk(false)}>
                    {m.assets_unpack()}
                  </Button>
                  <Field>
                    <FieldLabel>{m.assets_move_to()} </FieldLabel>
                    <SearchSelect
                      ariaLabel={m.assets_move_selected_items_to()}
                      value=""
                      isDisabled={busy || !selected.length}
                      onChange={(value) => {
                        if (value) void bulk(undefined, value === "unassigned" ? null : value);
                      }}
                    >
                      <option value="">{m.assets_choose_bag()}</option>
                      <option value="unassigned">{m.assets_unassigned()}</option>
                      {bags.map((bag) => (
                        <option key={bag.id} value={bag.id}>
                          {bag.name}
                        </option>
                      ))}
                    </SearchSelect>
                  </Field>
                  <Button
                    type="button"
                    className="secondary compact"
                    onClick={() => {
                      setSelected([]);
                      setSelecting(false);
                    }}
                  >
                    {m.assets_done()}
                  </Button>
                </div>
              )}
              {!!items.length && (
                <div className="flex flex-wrap gap-2">
                  {!selecting && (
                    <Button type="button" className="secondary compact" onClick={() => setSelecting(true)}>
                      {m.assets_select_items()}
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void bulk(true, undefined, true)}
                  >
                    {m.assets_pack_all()}
                  </Button>
                  <Button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void bulk(false, undefined, true)}
                  >
                    {m.assets_unpack_all()}
                  </Button>
                </div>
              )}
              {notice && (
                <p role="status" className="help">
                  {notice}
                </p>
              )}
              {!items.length && <p>{m.assets_no_items_yet_add_your_first_item()}</p>}
              {items.length > 0 && !visible.length && <p>{m.assets_no_items_for_this_filter()}</p>}
              <div className="space-y-4">
                {sections.map((section) => {
                  const sectionRows = visible.filter((item) =>
                    group === "bag"
                      ? item.bag_id === (section.bag?.id ?? null)
                      : (item.category?.trim() || "") === section.id,
                  );
                  const allRows = items.filter((item) =>
                    group === "bag"
                      ? item.bag_id === (section.bag?.id ?? null)
                      : (item.category?.trim() || "") === section.id,
                  );
                  if (group === "category" && !sectionRows.length) return null;
                  return (
                    <section key={section.id} className="rounded-xl border p-3 sm:p-4" aria-label={section.title}>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h4 className="text-lg font-semibold">{section.title}</h4>
                          <p className="text-sm">{count(allRows)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {group === "bag" && (
                            <>
                              <Button
                                type="button"
                                className="secondary compact"
                                onClick={() => startItem(undefined, section.bag?.id ?? null)}
                              >
                                {m.assets_quick_add()}
                              </Button>
                              {section.bag && (
                                <Button
                                  type="button"
                                  className="secondary compact"
                                  onClick={() => startBag(section.bag!)}
                                >
                                  {m.assets_edit_bag()}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {!sectionRows.length ? (
                        <p className="text-sm">{m.assets_no_items_here()}</p>
                      ) : (
                        <ul className="m-0 list-none divide-y p-0">
                          {sectionRows.map((item) => (
                            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                              <div className="flex items-start gap-3">
                                {selecting ? (
                                  <Field className="contents">
                                    <FieldLabel className="flex size-11 shrink-0 items-center justify-center">
                                      <span className="sr-only">{m.assets_select_line({ p0: item.label })}</span>
                                      <TravelCheckbox
                                        className="size-6"
                                        checked={selected.includes(item.id)}
                                        onCheckedChange={(checked) =>
                                          setSelected((current) =>
                                            checked ? [...current, item.id] : current.filter((id) => id !== item.id),
                                          )
                                        }
                                      />
                                    </FieldLabel>
                                  </Field>
                                ) : (
                                  <Field className="contents">
                                    <FieldLabel className="flex size-11 shrink-0 items-center justify-center">
                                      <span className="sr-only">
                                        {m.assets_packed_line({
                                          p0: item.quantity > 1 ? `${item.quantity} × ` : "",
                                          p1: item.label,
                                        })}
                                      </span>
                                      <TravelCheckbox
                                        className="size-6"
                                        checked={item.packed}
                                        disabled={savingIds.includes(item.id)}
                                        onCheckedChange={() => void toggle(item)}
                                      />
                                    </FieldLabel>
                                  </Field>
                                )}
                                <div className="min-w-0 flex-1 pt-1">
                                  <strong className={item.packed ? "line-through opacity-60" : ""}>
                                    {item.quantity > 1 ? `${item.quantity} × ` : ""}
                                    {item.label}
                                  </strong>
                                  <p className="text-sm opacity-70">
                                    {[
                                      item.category || m.assets_uncategorised(),
                                      group === "category"
                                        ? (bags.find((bag) => bag.id === item.bag_id)?.name ?? m.assets_unassigned())
                                        : null,
                                      item.weight_g !== null ? m.assets_per_item({ p0: grams(item.weight_g) }) : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                  {(item.essential ||
                                    item.last_minute ||
                                    item.valuable ||
                                    item.cabin_only ||
                                    item.checked_only) && (
                                    <p className="text-xs opacity-70">
                                      {[
                                        item.essential && m.assets_essential(),
                                        item.last_minute && m.assets_departure_day(),
                                        item.valuable && m.assets_valuable(),
                                        item.cabin_only && m.assets_cabin_baggage_only(),
                                        item.checked_only && m.assets_checked_baggage_only(),
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                  {item.notes && <p className="mt-1 text-sm">{item.notes}</p>}
                                  {item.id in unsaved && !savingIds.includes(item.id) && (
                                    <Button type="button" onClick={() => void toggle(item, unsaved[item.id])}>
                                      {m.assets_try_again_line({ p0: item.label })}
                                    </Button>
                                  )}
                                </div>
                                {!selecting && (
                                  <Button
                                    type="button"
                                    className="secondary compact shrink-0"
                                    aria-label={m.assets_edit({ p0: item.label })}
                                    onClick={() => startItem(item)}
                                  >
                                    {m.owner_edit()}
                                  </Button>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
      <RecordDialog
        open={itemDialog !== null}
        title={itemDialog === "new" ? m.assets_add_item() : m.assets_edit_item()}
        onDismiss={() => setItemDialog(null)}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!itemDraft.label.trim() || (itemDraft.cabin_only && itemDraft.checked_only)) return;
            void save(
              () =>
                request(
                  `${path}/items${itemDialog === "new" ? "" : `/${encodeURIComponent(itemDialog!)}`}`,
                  itemDialog === "new" ? "POST" : "PATCH",
                  { ...itemDraft, label: itemDraft.label.trim() },
                ),
              () => m.assets_item_saved(),
            ).then((ok) => {
              if (ok) setItemDialog(null);
            });
          }}
        >
          <Field className="contents">
            <FieldLabel className="block">
              {m.owner_name()}
              <Input
                autoFocus
                required
                maxLength={160}
                value={itemDraft.label}
                onChange={(event) => setItemDraft({ ...itemDraft, label: event.target.value })}
              />
            </FieldLabel>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_quantity()}
              <Input
                type="number"
                min="1"
                max="99"
                required
                value={itemDraft.quantity}
                onChange={(event) => setItemDraft({ ...itemDraft, quantity: Number(event.target.value) })}
              />
            </FieldLabel>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_category()}
              <Input
                maxLength={80}
                value={itemDraft.category ?? ""}
                onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value || null })}
              />
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel className="block">{m.assets_bag()}</FieldLabel>
            <SearchSelect
              ariaLabel={m.assets_bag()}
              value={itemDraft.bag_id ?? ""}
              onChange={(value) => setItemDraft({ ...itemDraft, bag_id: value || null })}
            >
              <option value="">{m.assets_unassigned()}</option>
              {bags.map((bag) => (
                <option key={bag.id} value={bag.id}>
                  {bag.name}
                </option>
              ))}
            </SearchSelect>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_weight_per_item_grams()}
              <Input
                type="number"
                min="0"
                value={itemDraft.weight_g ?? ""}
                onChange={(event) =>
                  setItemDraft({
                    ...itemDraft,
                    weight_g: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </FieldLabel>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_note()}
              <TravelTextarea
                maxLength={4000}
                value={itemDraft.notes ?? ""}
                onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value || null })}
              />
            </FieldLabel>
          </Field>
          {(["essential", "last_minute", "valuable", "cabin_only", "checked_only"] as const).map((flag) => (
            <Field className="contents" key={flag}>
              <FieldLabel className="block">
                <TravelCheckbox
                  className="size-5"
                  checked={itemDraft[flag]}
                  onCheckedChange={(checked) => setItemDraft({ ...itemDraft, [flag]: checked })}
                />{" "}
                {
                  {
                    essential: m.assets_essential(),
                    last_minute: m.assets_departure_day_lastminute(),
                    valuable: m.assets_valuable(),
                    cabin_only: m.assets_cabin_baggage_only(),
                    checked_only: m.assets_checked_baggage_only(),
                  }[flag]
                }
              </FieldLabel>
            </Field>
          ))}
          {itemDraft.cabin_only && itemDraft.checked_only && (
            <p role="alert">{m.assets_choose_at_most_one_baggage_restriction()}</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || (itemDraft.cabin_only && itemDraft.checked_only)}>
              {m.assets_save()}
            </Button>
            {itemDialog !== "new" && (
              <Button
                type="button"
                className="danger compact"
                onClick={() => setConfirm({ kind: "item", id: itemDialog! })}
              >
                {m.owner_delete()}
              </Button>
            )}
          </div>
        </form>
        {confirm?.kind === "item" && (
          <DeleteConfirmation
            title={m.assets_delete_item()}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              void save(
                () => request(`${path}/items/${encodeURIComponent(confirm.id)}`, "DELETE"),
                () => m.assets_item_deleted(),
              ).then((ok) => {
                if (ok) {
                  setItemDialog(null);
                  setConfirm(null);
                }
              });
            }}
          />
        )}
      </RecordDialog>
      <RecordDialog
        open={bagDialog !== null}
        title={bagDialog === "new" ? m.assets_add_bag() : m.assets_edit_bag()}
        onDismiss={() => setBagDialog(null)}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!bagDraft.name.trim()) return;
            void save(
              () =>
                request(
                  `${path}/bags${bagDialog === "new" ? "" : `/${encodeURIComponent(bagDialog!)}`}`,
                  bagDialog === "new" ? "POST" : "PATCH",
                  { ...bagDraft, name: bagDraft.name.trim() },
                ),
              () => m.assets_bag_saved(),
            ).then((ok) => {
              if (ok) setBagDialog(null);
            });
          }}
        >
          <Field className="contents">
            <FieldLabel className="block">
              {m.owner_name()}
              <Input
                autoFocus
                required
                maxLength={160}
                value={bagDraft.name}
                onChange={(event) => setBagDraft({ ...bagDraft, name: event.target.value })}
              />
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel className="block">{m.assets_type()}</FieldLabel>
            <SearchSelect
              ariaLabel={m.assets_type()}
              value={bagDraft.type ?? ""}
              onChange={(value) => setBagDraft({ ...bagDraft, type: value || null })}
            >
              <option value="">{m.assets_no_type()}</option>
              {bagTypes().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SearchSelect>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_weight_limit_grams()}
              <Input
                type="number"
                min="1"
                value={bagDraft.weight_limit_g ?? ""}
                onChange={(event) =>
                  setBagDraft({
                    ...bagDraft,
                    weight_limit_g: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </FieldLabel>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {m.assets_save()}
            </Button>
            {bagDialog !== "new" && (
              <Button
                type="button"
                className="danger compact"
                onClick={() => setConfirm({ kind: "bag", id: bagDialog! })}
              >
                {m.owner_delete()}
              </Button>
            )}
          </div>
        </form>
        {confirm?.kind === "bag" && (
          <DeleteConfirmation
            title={m.assets_delete_bag()}
            description={m.assets_the_items_remain_as_unassigned()}
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              void save(
                () => request(`${path}/bags/${encodeURIComponent(confirm.id)}`, "DELETE"),
                () => m.assets_bag_deleted_items_are_unassigned(),
              ).then((ok) => {
                if (ok) {
                  setBagDialog(null);
                  setConfirm(null);
                }
              });
            }}
          />
        )}
      </RecordDialog>
      <RecordDialog open={reuseOpen} title={m.assets_reuse_packing_list()} onDismiss={() => setReuseOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reuseMode === "copy" ? !sourceId : !templateIds.length) return;
            void save(
              async () => {
                const created = await request<PackingList>(base, "POST", {
                  name: reuseName.trim(),
                  ...(reuseMode === "copy" ? { copy_from_list_id: sourceId } : { template_ids: templateIds }),
                });
                setChosenList(created.id);
                setUnsaved({});
              },
              () => m.assets_packing_list_reused_all_items_are_unpacked(),
            ).then((ok) => {
              if (ok) setReuseOpen(false);
            });
          }}
        >
          <ChoiceGroup
            label={m.assets_source()}
            value={reuseMode}
            choices={[
              { value: "copy", label: m.assets_another_packing_list() },
              { value: "templates", label: m.assets_templates() },
            ]}
            onChange={setReuseMode}
          />
          {reuseMode === "copy" ? (
            <Field>
              <FieldLabel className="block">{m.assets_packing_list()}</FieldLabel>
              <SearchSelect ariaLabel={m.assets_source_packing_list()} value={sourceId} onChange={setSourceId}>
                <option value="">{m.assets_choose_a_packing_list()}</option>
                {sourcesQuery.data
                  ?.filter((source) => source.trip_id !== trip.id)
                  .map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.trip_title} · {source.name}
                    </option>
                  ))}
              </SearchSelect>
            </Field>
          ) : (
            <FieldSet className="space-y-2">
              <FieldLegend>{m.assets_choose_templates()}</FieldLegend>
              {templatesQuery.data?.map((template) => (
                <div key={template.id} className="flex items-center justify-between gap-2">
                  <Field className="contents">
                    <FieldLabel className="block">
                      <TravelCheckbox
                        checked={templateIds.includes(template.id)}
                        onCheckedChange={(checked) =>
                          setTemplateIds((current) =>
                            checked ? [...current, template.id] : current.filter((id) => id !== template.id),
                          )
                        }
                      />{" "}
                      {template.name}
                    </FieldLabel>
                  </Field>
                  <Button
                    type="button"
                    className="secondary compact"
                    aria-label={m.assets_delete({ p0: template.name })}
                    onClick={() => setTemplateToDelete(template.id)}
                  >
                    {m.owner_delete()}
                  </Button>
                </div>
              ))}
            </FieldSet>
          )}
          {(sourcesQuery.isError || templatesQuery.isError) && (
            <p role="alert">{m.assets_loading_sources_failed_close_and_reopen_to_try_again()}</p>
          )}
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_new_packing_list_name()}
              <Input
                required
                maxLength={160}
                value={reuseName}
                onChange={(event) => setReuseName(event.target.value)}
              />
            </FieldLabel>
          </Field>
          <p className="text-sm">
            {m.assets_bags_order_categories_quantities_notes_and_assignments_are_preserved_all()}
          </p>
          <Button
            type="submit"
            disabled={busy || !reuseName.trim() || (reuseMode === "copy" ? !sourceId : !templateIds.length)}
          >
            {m.assets_create_new_packing_list()}
          </Button>
        </form>
        {templateToDelete && (
          <DeleteConfirmation
            title={m.assets_delete_template()}
            onCancel={() => setTemplateToDelete(null)}
            onConfirm={() => {
              void save(
                () => request(`/api/packing-templates/${encodeURIComponent(templateToDelete)}`, "DELETE"),
                () => m.assets_template_deleted(),
              ).then((ok) => {
                if (ok) {
                  setTemplateIds((current) => current.filter((id) => id !== templateToDelete));
                  setTemplateToDelete(null);
                  void client.invalidateQueries({ queryKey: [...key, "templates"] });
                }
              });
            }}
          />
        )}
      </RecordDialog>
      <RecordDialog
        open={templateName !== null}
        title={m.assets_save_as_template()}
        onDismiss={() => setTemplateName(null)}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!templateName?.trim()) return;
            void save(
              () => request(`${path}/templates`, "POST", { name: templateName.trim() }),
              () => m.assets_template_saved(),
            ).then((ok) => {
              if (ok) setTemplateName(null);
            });
          }}
        >
          <Field className="contents">
            <FieldLabel className="block">
              {m.assets_template_name()}
              <Input
                autoFocus
                required
                maxLength={160}
                value={templateName ?? ""}
                onChange={(event) => setTemplateName(event.target.value)}
              />
            </FieldLabel>
          </Field>
          <Button type="submit" disabled={busy || !templateName?.trim()}>
            {m.assets_save_2()}
          </Button>
        </form>
      </RecordDialog>
    </section>
  );
}
