import { Button } from "@/ui/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SearchSelect } from "../forms/fields";
import { useLocale } from "../locale";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { m } from "../paraglide/messages.js";
import { ownerRequest } from "../query/api";
import { errorNotice, textNotice, useFeedback } from "../query/feedback";
import { tripPath, useOwner } from "../query/owner-queries";
import type { Trip } from "../tracker-model";
import { Field, FieldLabel } from "@/ui/field";
import { BagDialog } from "./packing/BagDialog";
import { BagSummaries } from "./packing/BagSummaries";
import { DepartureCheck } from "./packing/DepartureCheck";
import { ItemDialog } from "./packing/ItemDialog";
import { ItemSections } from "./packing/ItemSections";
import {
  count,
  emptyBag,
  emptyItem,
  ordered,
  type Bag,
  type BagDraft,
  type Filter,
  type Group,
  type Item,
  type ItemDraft,
  type PackingList,
  type PendingDelete,
} from "./packing/model";
import { PackingOfflineFallback } from "./packing/PackingOfflineFallback";
import { PackingProgress } from "./packing/PackingProgress";
import { ReuseDialog } from "./packing/ReuseDialog";
import { Suggestions } from "./packing/Suggestions";
import { TemplateDialog } from "./packing/TemplateDialog";
import { Toolbar } from "./packing/Toolbar";
import type { PackingSnapshot } from "./PackingOfflineView";

export function PackingManager({ trip }: { trip: Trip }) {
  useLocale();
  const owner = useOwner();
  const offline = useOfflineCopies();
  const client = useQueryClient();
  const base = tripPath(trip.id, "packing-lists");
  const key = ["owner", owner?.subject, "trip", trip.id, "packing"];
  const listsQuery = useQuery({
    queryKey: [...key, "lists"],
    enabled: !!owner,
    queryFn: () =>
      ownerRequest<PackingList[]>(owner!.session, base, m.assets_loading_packing_lists_failed),
  });
  const [chosenList, setChosenList] = useState<string | null>(null);
  const list =
    listsQuery.data?.find((row) => row.id === chosenList) ?? listsQuery.data?.[0] ?? null;
  const path = list ? `${base}/${encodeURIComponent(list.id)}` : "";
  const bagsQuery = useQuery({
    queryKey: [...key, list?.id, "bags"],
    enabled: !!owner && !!list,
    queryFn: () =>
      ownerRequest<Bag[]>(owner!.session, `${path}/bags`, m.assets_loading_bags_failed),
  });
  const itemsQuery = useQuery({
    queryKey: [...key, list?.id, "items"],
    enabled: !!owner && !!list,
    queryFn: () =>
      ownerRequest<Item[]>(owner!.session, `${path}/items`, m.assets_loading_packing_items_failed),
  });
  const [group, setGroup] = useState<Group>("bag");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [itemDialog, setItemDialog] = useState<string | "new" | null>(null);
  const [bagDialog, setBagDialog] = useState<string | "new" | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItem(null));
  const [bagDraft, setBagDraft] = useState<BagDraft>(emptyBag);
  const [confirm, setConfirm] = useState<PendingDelete>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useFeedback<string>("");
  const [reuseOpen, setReuseOpen] = useState(false);
  const [reuseName, setReuseName] = useState<string>(() => m.assets_packing_list());
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Failed toggles remain visible at the requested state until the owner retries or reloads.
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const bags = ordered(bagsQuery.data ?? []);
  const serverItems = itemsQuery.data ?? [];
  const items = serverItems.map((item) =>
    item.id in unsaved ? { ...item, packed: unsaved[item.id] } : item,
  );
  const visible = ordered(items).filter(
    (item) =>
      (filter === "all" ||
        (filter === "last-minute" ? item.last_minute : item.packed === (filter === "packed"))) &&
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
      const saved = await request<Item>(`${path}/items/${encodeURIComponent(item.id)}`, "PATCH", {
        packed,
      });
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
    setBagDraft(
      bag ? { name: bag.name, type: bag.type, weight_limit_g: bag.weight_limit_g } : emptyBag(),
    );
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
  const savedCopies = offline.copies.filter(
    (copy) => copy.resourceKind === "packing_list" && copy.metadataUrl.startsWith(`${base}/`),
  );
  const savedCopy = savedCopies.find((copy) => copy.resourceId === chosenList) ?? savedCopies[0];
  const showingCopy =
    !offline.online || listsQuery.isError || (list && (bagsQuery.isError || itemsQuery.isError));
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
      setNotice(
        textNotice(() =>
          m.assets_packing_list_saved_offline_on_this_device_changes_require_a_connection(),
        ),
      );
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
      <PackingOfflineFallback
        offline={offline}
        savedCopies={savedCopies}
        savedCopy={savedCopy}
        listsQuery={listsQuery}
        bagsQuery={bagsQuery}
        itemsQuery={itemsQuery}
        onChoose={setChosenList}
        onRetry={() => void refresh()}
      />
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
            <Button
              className="secondary compact"
              type="button"
              onClick={() => setTemplateName(list.name)}
            >
              {m.assets_save_as_template()}
            </Button>
          )}
          {list && (
            <Button
              className="secondary compact"
              type="button"
              onClick={() => setShowSuggestions(!showSuggestions)}
            >
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
              {offline.isPinned("packing_list", list.id)
                ? m.assets_refresh_offline_copy()
                : m.owner_save_offline()}
            </Button>
          )}
          {list && offline.isPinned("packing_list", list.id) && (
            <Button
              className="secondary compact"
              type="button"
              onClick={() => void removeOfflineCopy()}
            >
              {m.owner_remove_offline_copy()}
            </Button>
          )}
        </div>
      </div>
      {list && offline.isPinned("packing_list", list.id) && (
        <p className="text-sm">
          {m.assets_an_offline_copy_has_been_saved_refresh_after_changes_to_take_the_latest_()}
        </p>
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
              <Suggestions
                show={showSuggestions}
                listId={list.id}
                path={path}
                queryKey={key}
                onAdd={(suggestion) => {
                  setItemDraft({
                    ...emptyItem(null),
                    label: suggestion.label,
                    category: suggestion.category,
                    essential: suggestion.usually_essential,
                  });
                  setItemDialog("new");
                }}
              />
              <DepartureCheck bags={bags} items={items} />
              <BagSummaries bags={bags} items={items} />
              <Toolbar
                bags={bags}
                hasItems={!!items.length}
                group={group}
                onGroup={setGroup}
                filter={filter}
                onFilter={setFilter}
                search={search}
                onSearch={setSearch}
                selecting={selecting}
                onSelecting={setSelecting}
                selected={selected}
                onSelected={setSelected}
                busy={busy}
                bulk={bulk}
              />
              {notice && (
                <p role="status" className="help">
                  {notice}
                </p>
              )}
              {!items.length && <p>{m.assets_no_items_yet_add_your_first_item()}</p>}
              {items.length > 0 && !visible.length && <p>{m.assets_no_items_for_this_filter()}</p>}
              <ItemSections
                bags={bags}
                items={items}
                visible={visible}
                group={group}
                selecting={selecting}
                selected={selected}
                onSelected={setSelected}
                savingIds={savingIds}
                unsaved={unsaved}
                onToggle={(item, packed) => void toggle(item, packed)}
                onStartItem={startItem}
                onStartBag={startBag}
              />
            </>
          )}
        </>
      )}
      <ItemDialog
        dialog={itemDialog}
        draft={itemDraft}
        setDraft={setItemDraft}
        bags={bags}
        busy={busy}
        path={path}
        save={save}
        request={request}
        confirm={confirm}
        onConfirmDelete={setConfirm}
        onClose={() => setItemDialog(null)}
      />
      <BagDialog
        dialog={bagDialog}
        draft={bagDraft}
        setDraft={setBagDraft}
        busy={busy}
        path={path}
        save={save}
        request={request}
        confirm={confirm}
        onConfirmDelete={setConfirm}
        onClose={() => setBagDialog(null)}
      />
      <ReuseDialog
        open={reuseOpen}
        tripId={trip.id}
        base={base}
        queryKey={key}
        name={reuseName}
        onName={setReuseName}
        busy={busy}
        save={save}
        request={request}
        onCreated={(created) => {
          setChosenList(created.id);
          setUnsaved({});
        }}
        onClose={() => setReuseOpen(false)}
      />
      <TemplateDialog
        name={templateName}
        onName={setTemplateName}
        busy={busy}
        path={path}
        save={save}
        request={request}
        onClose={() => setTemplateName(null)}
      />
    </section>
  );
}
