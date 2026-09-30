import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback } from "../query/feedback";
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
  value >= 1000 ? `${(value / 1000).toLocaleString("nl-BE", { maximumFractionDigits: 2 })} kg` : `${value} g`;
const count = (rows: Item[]) => {
  const packed = rows.filter((item) => item.packed).length;
  return `${packed} van ${rows.length} ingepakt · ${rows.length - packed} te gaan`;
};
function PackingProgress({ rows, label }: { rows: Item[]; label: string }) {
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
const BAG_TYPES = [
  ["cabin", "🧳 Handbagage"],
  ["checked", "🧳 Ruimbagage"],
  ["day", "🎒 Dag- of overnachtingstas"],
  ["person", "👤 Op persoon"],
  ["other", "📦 Overig"],
] as const;

export function PackingManager({ trip }: { trip: Trip }) {
  const owner = useOwner();
  const offline = useOfflineCopies();
  const client = useQueryClient();
  const base = tripPath(trip.id, "packing-lists");
  const key = ["owner", owner?.subject, "trip", trip.id, "packing"];
  const listsQuery = useQuery({
    queryKey: [...key, "lists"],
    enabled: !!owner,
    queryFn: () => ownerRequest<PackingList[]>(owner!.session, base, "Paklijsten laden mislukt."),
  });
  const [chosenList, setChosenList] = useState<string | null>(null);
  const list = listsQuery.data?.find((row) => row.id === chosenList) ?? listsQuery.data?.[0] ?? null;
  const path = list ? `${base}/${encodeURIComponent(list.id)}` : "";
  const bagsQuery = useQuery({
    queryKey: [...key, list?.id, "bags"],
    enabled: !!owner && !!list,
    queryFn: () => ownerRequest<Bag[]>(owner!.session, `${path}/bags`, "Tassen laden mislukt."),
  });
  const itemsQuery = useQuery({
    queryKey: [...key, list?.id, "items"],
    enabled: !!owner && !!list,
    queryFn: () => ownerRequest<Item[]>(owner!.session, `${path}/items`, "Inpakitems laden mislukt."),
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
  const [reuseName, setReuseName] = useState("Paklijst");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<string | null>(null);
  const [leavingSoon, setLeavingSoon] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const sourcesQuery = useQuery({
    queryKey: [...key, "sources"],
    enabled: !!owner && reuseOpen,
    queryFn: () =>
      ownerRequest<PackingSource[]>(owner!.session, "/api/packing-list-sources", "Bronlijsten laden mislukt."),
  });
  const templatesQuery = useQuery({
    queryKey: [...key, "templates"],
    enabled: !!owner && reuseOpen,
    queryFn: () =>
      ownerRequest<PackingTemplate[]>(owner!.session, "/api/packing-templates", "Sjablonen laden mislukt."),
  });
  const suggestionsQuery = useQuery({
    queryKey: [...key, list?.id, "suggestions"],
    enabled: !!owner && !!list && showSuggestions,
    queryFn: () =>
      ownerRequest<PackingSuggestion[]>(owner!.session, `${path}/suggestions`, "Suggesties laden mislukt."),
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
    ownerRequest<T>(owner!.session, url, "Opslaan mislukt.", { method, body });
  async function save(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(success);
      return true;
    } catch (error) {
      // A multi-item action may have saved some rows before one request failed.
      await refresh().catch(() => undefined);
      setNotice(errorNotice(error, "Opslaan mislukt. Probeer opnieuw."));
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
      setNotice(errorNotice(error, "Afvinken mislukt.", () => m.api_packing_retry()));
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
    const ok = await save(async () => {
      for (const item of targets)
        await request(
          `${path}/items/${encodeURIComponent(item.id)}`,
          "PATCH",
          packed === undefined ? { bag_id: bagId } : { packed },
        );
    }, `${targets.length} items bijgewerkt.`);
    if (ok) setSelected([]);
  }
  const sections =
    group === "bag"
      ? [
          ...bags.map((bag) => ({ id: bag.id, title: bag.name, bag })),
          { id: "unassigned", title: "Niet toegewezen", bag: null },
        ]
      : [...new Set(visible.map((item) => item.category?.trim() || "Zonder categorie"))]
          .sort((a, b) => a.localeCompare(b, "nl"))
          .map((title) => ({ id: title, title, bag: null }));
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
        ownerRequest<PackingList>(owner.session, path, "Paklijst laden mislukt."),
        ownerRequest<Bag[]>(owner.session, `${path}/bags`, "Tassen laden mislukt."),
        ownerRequest<Item[]>(owner.session, `${path}/items`, "Inpakitems laden mislukt."),
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
      setNotice("Paklijst offline bewaard op dit toestel. Wijzigingen vragen een verbinding.");
    } catch (error) {
      setNotice(errorNotice(error, "De paklijst kon niet offline worden bewaard."));
    } finally {
      setBusy(false);
    }
  }
  async function removeOfflineCopy() {
    if (!list) return;
    await offline.removeByResource("packing_list", list.id);
    setNotice("Paklijst is niet langer offline beschikbaar.");
  }

  if (showingCopy)
    return (
      <section className="space-y-4" aria-labelledby="packing-title">
        <h3 id="packing-title" className="text-2xl font-semibold">
          Inpakken
        </h3>
        {savedCopies.length > 1 && (
          <Field>
            <FieldLabel className="block">Offline paklijst </FieldLabel>
            <SearchSelect ariaLabel="Offline paklijst" value={savedCopy?.resourceId ?? ""} onChange={setChosenList}>
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
              ? errorMessage(listsQuery.error, "Paklijsten laden mislukt.")
              : offline.online && (bagsQuery.isError || itemsQuery.isError)
                ? "Inpaklijst laden mislukt."
                : offline.loaded
                  ? "Geen offline paklijst bewaard voor deze reis. Verbind opnieuw om er een te bewaren."
                  : "Offline paklijsten laden…"}
          </p>
        )}
        {offline.online && (
          <Button type="button" onClick={() => void refresh()}>
            Opnieuw proberen
          </Button>
        )}
      </section>
    );

  if (listsQuery.isPending)
    return (
      <section className="rounded-xl border p-5" role="status">
        Paklijsten laden…
      </section>
    );
  return (
    <section className="travel-card space-y-5" aria-labelledby="packing-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="packing-title" className="text-2xl font-semibold">
            Inpakken
          </h3>
          <p className="text-sm">Alleen voor jou · {count(items)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {list && (
            <Button className="secondary compact" type="button" onClick={() => startBag()}>
              Tas toevoegen
            </Button>
          )}
          {list && (
            <Button className="compact" type="button" onClick={() => startItem()}>
              Item toevoegen
            </Button>
          )}
          <Button className="secondary compact" type="button" onClick={() => setReuseOpen(true)}>
            Lijst hergebruiken
          </Button>
          {list && (
            <Button className="secondary compact" type="button" onClick={() => setTemplateName(list.name)}>
              Als sjabloon bewaren
            </Button>
          )}
          {list && (
            <Button className="secondary compact" type="button" onClick={() => setShowSuggestions(!showSuggestions)}>
              Suggesties uit eerdere reizen
            </Button>
          )}
          {list && (
            <Button
              className="secondary compact"
              type="button"
              disabled={busy || offline.unsupported || !offline.online}
              onClick={() => void saveOfflineCopy()}
            >
              {offline.isPinned("packing_list", list.id) ? "Offline kopie vernieuwen" : "Offline bewaren"}
            </Button>
          )}
          {list && offline.isPinned("packing_list", list.id) && (
            <Button className="secondary compact" type="button" onClick={() => void removeOfflineCopy()}>
              Offline verwijderen
            </Button>
          )}
        </div>
      </div>
      {list && offline.isPinned("packing_list", list.id) && (
        <p className="text-sm">
          Een offline kopie is bewaard. Vernieuw na wijzigingen om de laatste stand mee te nemen.
        </p>
      )}
      {!list ? (
        <div className="rounded-xl border p-5">
          <p>Nog geen paklijst voor deze reis.</p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void save(() => request(base, "POST", { name: "Paklijst" }), "Paklijst aangemaakt.")}
          >
            Paklijst maken
          </Button>
        </div>
      ) : (
        <>
          {(listsQuery.data?.length ?? 0) > 1 && (
            <Field>
              <FieldLabel className="block">Paklijst </FieldLabel>
              <SearchSelect
                ariaLabel="Paklijst"
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
            <p role="status">Inpaklijst laden…</p>
          ) : bagsQuery.isError || itemsQuery.isError ? (
            <div role="alert">
              Inpaklijst laden mislukt.{" "}
              <Button type="button" onClick={() => void refresh()}>
                Opnieuw proberen
              </Button>
            </div>
          ) : (
            <>
              <PackingProgress rows={items} label="Totale inpakvoortgang" />
              {showSuggestions && (
                <section aria-label="Suggesties uit eerdere reizen" className="space-y-2 rounded-xl border p-4">
                  <h4 className="font-semibold">Misschien nog meenemen</h4>
                  {suggestionsQuery.isPending && <p>Suggesties laden…</p>}
                  {suggestionsQuery.isError && (
                    <p role="alert">
                      Suggesties laden mislukt.{" "}
                      <Button type="button" onClick={() => void suggestionsQuery.refetch()}>
                        Opnieuw proberen
                      </Button>
                    </p>
                  )}
                  {suggestionsQuery.data
                    ?.filter((suggestion) => !dismissedSuggestions.includes(`${list.id}:${suggestion.label}`))
                    .map((suggestion) => (
                      <div key={suggestion.label} className="flex flex-wrap items-center gap-2 border-t py-2">
                        <p className="flex-1">
                          {suggestion.label} · op {suggestion.prior_trips} eerdere reizen
                          {suggestion.usually_cabin ? " · meestal in handbagage" : ""}
                          {suggestion.usually_essential ? " · meestal essentieel" : ""}
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
                          Toevoegen
                        </Button>
                        <Button
                          type="button"
                          className="secondary compact"
                          onClick={() =>
                            setDismissedSuggestions((current) => [...current, `${list.id}:${suggestion.label}`])
                          }
                        >
                          Negeren
                        </Button>
                      </div>
                    ))}
                  {suggestionsQuery.data?.length === 0 && <p>Nog geen terugkerende items om voor te stellen.</p>}
                </section>
              )}
              <Button
                type="button"
                className="secondary compact"
                aria-expanded={leavingSoon}
                onClick={() => setLeavingSoon(!leavingSoon)}
              >
                Vertrekcheck
              </Button>
              {leavingSoon && (
                <section aria-label="Vertrekcheck" className="space-y-3 rounded-xl border p-4">
                  <h4 className="text-lg font-semibold">Vertrekcheck</h4>
                  <p>{count(items)}</p>
                  <ul className="m-0 list-none space-y-1 p-0">
                    {bags.map((bag) => {
                      const rows = items.filter((item) => item.bag_id === bag.id);
                      const known = rows.reduce((sum, item) => sum + (item.weight_g ?? 0) * item.quantity, 0);
                      return (
                        <li key={bag.id}>
                          {bag.name}: {count(rows)} · {grams(known)} bekend
                          {bag.weight_limit_g ? ` / ${grams(bag.weight_limit_g)} limiet` : ""}
                          {rows.some((item) => item.weight_g === null) ? " · gewicht niet volledig" : ""}
                        </li>
                      );
                    })}
                  </ul>
                  {items.length > 0 &&
                    !unpackedEssentials.length &&
                    !unpackedLastMinute.length &&
                    !unassigned.length &&
                    !conflicts.length &&
                    !overweight.length && <p className="font-semibold">Klaar om te vertrekken</p>}
                  {!!unpackedEssentials.length && (
                    <p>Essentieel, nog in te pakken: {unpackedEssentials.map((item) => item.label).join(", ")}</p>
                  )}
                  {!!unpackedLastMinute.length && (
                    <p>Op de vertrekdag: {unpackedLastMinute.map((item) => item.label).join(", ")}</p>
                  )}
                  {!!unassigned.length && <p>Nog zonder tas: {unassigned.map((item) => item.label).join(", ")}</p>}
                  {!!overweight.length && (
                    <p>
                      Bekend gewicht boven ingestelde limiet: {overweight.map((bag) => bag.name).join(", ")}. Onbekende
                      gewichten tellen niet mee.
                    </p>
                  )}
                  {!!conflicts.length && (
                    <p>Controleer je eigen bagagekeuze: {conflicts.map((item) => item.label).join(", ")}</p>
                  )}
                  <p className="text-sm">Bagagevlaggen zijn je eigen notities, geen officiële reisregels.</p>
                </section>
              )}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-label="Voortgang per tas">
                {bags.map((bag) => {
                  const rows = items.filter((item) => item.bag_id === bag.id);
                  const known = rows.reduce((sum, item) => sum + (item.weight_g ?? 0) * item.quantity, 0);
                  const unknown = rows.some((item) => item.weight_g === null);
                  return (
                    <div key={bag.id} className="rounded-xl border p-3">
                      <strong>{bag.name}</strong>
                      {bag.type && (
                        <p className="text-sm">{BAG_TYPES.find(([type]) => type === bag.type)?.[1] ?? bag.type}</p>
                      )}
                      <p>{count(rows)}</p>
                      <PackingProgress rows={rows} label={`Inpakvoortgang ${bag.name}`} />
                      <p>
                        {grams(known)} bekend{unknown ? " · gewicht niet volledig" : ""}
                        {bag.weight_limit_g ? ` / ${grams(bag.weight_limit_g)} limiet` : ""}
                      </p>
                      {bag.weight_limit_g !== null && known > bag.weight_limit_g && (
                        <p role="alert" className="font-bold text-travel-danger!">
                          Over de gewichtslimiet
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 rounded-xl border p-3">
                <ChoiceGroup<Group>
                  label="Groeperen"
                  value={group}
                  choices={[
                    { value: "bag", label: "Per tas" },
                    { value: "category", label: "Per categorie" },
                  ]}
                  onChange={setGroup}
                />
                <ChoiceGroup<Filter>
                  label="Toon"
                  value={filter}
                  choices={[
                    { value: "all", label: "Alles" },
                    { value: "unpacked", label: "Niet ingepakt" },
                    { value: "packed", label: "Ingepakt" },
                    { value: "last-minute", label: "Vertrekdag" },
                  ]}
                  onChange={setFilter}
                />
                <Field className="contents">
                  <FieldLabel>
                    Zoeken{" "}
                    <Input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      className="rounded border p-2"
                    />
                  </FieldLabel>
                </Field>
              </div>
              {selecting && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                  <span>{selected.length} geselecteerd</span>
                  <Button type="button" disabled={busy || !selected.length} onClick={() => void bulk(true)}>
                    Inpakken
                  </Button>
                  <Button type="button" disabled={busy || !selected.length} onClick={() => void bulk(false)}>
                    Uitpakken
                  </Button>
                  <Field>
                    <FieldLabel>Verplaatsen naar </FieldLabel>
                    <SearchSelect
                      ariaLabel="Geselecteerde items verplaatsen naar"
                      value=""
                      isDisabled={busy || !selected.length}
                      onChange={(value) => {
                        if (value) void bulk(undefined, value === "unassigned" ? null : value);
                      }}
                    >
                      <option value="">Kies tas…</option>
                      <option value="unassigned">Niet toegewezen</option>
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
                    Klaar
                  </Button>
                </div>
              )}
              {!!items.length && (
                <div className="flex flex-wrap gap-2">
                  {!selecting && (
                    <Button type="button" className="secondary compact" onClick={() => setSelecting(true)}>
                      Items selecteren
                    </Button>
                  )}
                  <Button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void bulk(true, undefined, true)}
                  >
                    Alles inpakken
                  </Button>
                  <Button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => void bulk(false, undefined, true)}
                  >
                    Alles uitpakken
                  </Button>
                </div>
              )}
              {notice && (
                <p role="status" className="help">
                  {notice}
                </p>
              )}
              {!items.length && <p>Nog geen items. Voeg je eerste item toe.</p>}
              {items.length > 0 && !visible.length && <p>Geen items voor deze filter.</p>}
              <div className="space-y-4">
                {sections.map((section) => {
                  const sectionRows = visible.filter((item) =>
                    group === "bag"
                      ? item.bag_id === (section.bag?.id ?? null)
                      : (item.category?.trim() || "Zonder categorie") === section.id,
                  );
                  const allRows = items.filter((item) =>
                    group === "bag"
                      ? item.bag_id === (section.bag?.id ?? null)
                      : (item.category?.trim() || "Zonder categorie") === section.id,
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
                                Snel toevoegen
                              </Button>
                              {section.bag && (
                                <Button
                                  type="button"
                                  className="secondary compact"
                                  onClick={() => startBag(section.bag!)}
                                >
                                  Tas bewerken
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {!sectionRows.length ? (
                        <p className="text-sm">Geen items hier.</p>
                      ) : (
                        <ul className="m-0 list-none divide-y p-0">
                          {sectionRows.map((item) => (
                            <li key={item.id} className="py-3 first:pt-0 last:pb-0">
                              <div className="flex items-start gap-3">
                                {selecting ? (
                                  <Field className="contents">
                                    <FieldLabel className="flex size-11 shrink-0 items-center justify-center">
                                      <span className="sr-only">Selecteer {item.label}</span>
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
                                        {item.quantity > 1 ? `${item.quantity} × ` : ""}
                                        {item.label} ingepakt
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
                                      item.category || "Zonder categorie",
                                      group === "category"
                                        ? (bags.find((bag) => bag.id === item.bag_id)?.name ?? "Niet toegewezen")
                                        : null,
                                      item.weight_g !== null ? `${grams(item.weight_g)} per stuk` : null,
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
                                        item.essential && "Essentieel",
                                        item.last_minute && "Vertrekdag",
                                        item.valuable && "Waardevol",
                                        item.cabin_only && "Alleen handbagage",
                                        item.checked_only && "Alleen ruimbagage",
                                      ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    </p>
                                  )}
                                  {item.notes && <p className="mt-1 text-sm">{item.notes}</p>}
                                  {item.id in unsaved && !savingIds.includes(item.id) && (
                                    <Button type="button" onClick={() => void toggle(item, unsaved[item.id])}>
                                      Opnieuw proberen: {item.label}
                                    </Button>
                                  )}
                                </div>
                                {!selecting && (
                                  <Button
                                    type="button"
                                    className="secondary compact shrink-0"
                                    aria-label={`${item.label} bewerken`}
                                    onClick={() => startItem(item)}
                                  >
                                    Bewerken
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
        title={itemDialog === "new" ? "Item toevoegen" : "Item bewerken"}
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
              "Item opgeslagen.",
            ).then((ok) => {
              if (ok) setItemDialog(null);
            });
          }}
        >
          <Field className="contents">
            <FieldLabel className="block">
              Naam
              <Input
                autoFocus
                required
                maxLength={160}
                value={itemDraft.label}
                onChange={(event) => setItemDraft({ ...itemDraft, label: event.target.value })}
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              Aantal
              <Input
                type="number"
                min="1"
                max="99"
                required
                value={itemDraft.quantity}
                onChange={(event) => setItemDraft({ ...itemDraft, quantity: Number(event.target.value) })}
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              Categorie
              <Input
                maxLength={80}
                value={itemDraft.category ?? ""}
                onChange={(event) => setItemDraft({ ...itemDraft, category: event.target.value || null })}
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel className="block">Tas</FieldLabel>
            <SearchSelect
              ariaLabel="Tas"
              value={itemDraft.bag_id ?? ""}
              onChange={(value) => setItemDraft({ ...itemDraft, bag_id: value || null })}
            >
              <option value="">Niet toegewezen</option>
              {bags.map((bag) => (
                <option key={bag.id} value={bag.id}>
                  {bag.name}
                </option>
              ))}
            </SearchSelect>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              Gewicht per stuk (gram)
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
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              Notitie
              <TravelTextarea
                maxLength={4000}
                value={itemDraft.notes ?? ""}
                onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value || null })}
                className="block w-full rounded border p-2"
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
                    essential: "Essentieel",
                    last_minute: "Vertrekdag / last-minute",
                    valuable: "Waardevol",
                    cabin_only: "Alleen handbagage",
                    checked_only: "Alleen ruimbagage",
                  }[flag]
                }
              </FieldLabel>
            </Field>
          ))}
          {itemDraft.cabin_only && itemDraft.checked_only && <p role="alert">Kies maximaal één bagagebeperking.</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || (itemDraft.cabin_only && itemDraft.checked_only)}>
              Opslaan
            </Button>
            {itemDialog !== "new" && (
              <Button
                type="button"
                className="danger compact"
                onClick={() => setConfirm({ kind: "item", id: itemDialog! })}
              >
                Verwijderen
              </Button>
            )}
          </div>
        </form>
        {confirm?.kind === "item" && (
          <DeleteConfirmation
            title="Item verwijderen?"
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              void save(
                () => request(`${path}/items/${encodeURIComponent(confirm.id)}`, "DELETE"),
                "Item verwijderd.",
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
        title={bagDialog === "new" ? "Tas toevoegen" : "Tas bewerken"}
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
              "Tas opgeslagen.",
            ).then((ok) => {
              if (ok) setBagDialog(null);
            });
          }}
        >
          <Field className="contents">
            <FieldLabel className="block">
              Naam
              <Input
                autoFocus
                required
                maxLength={160}
                value={bagDraft.name}
                onChange={(event) => setBagDraft({ ...bagDraft, name: event.target.value })}
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel className="block">Type</FieldLabel>
            <SearchSelect
              ariaLabel="Type"
              value={bagDraft.type ?? ""}
              onChange={(value) => setBagDraft({ ...bagDraft, type: value || null })}
            >
              <option value="">Geen type</option>
              {BAG_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SearchSelect>
          </Field>
          <Field className="contents">
            <FieldLabel className="block">
              Gewichtslimiet (gram)
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
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Opslaan
            </Button>
            {bagDialog !== "new" && (
              <Button
                type="button"
                className="danger compact"
                onClick={() => setConfirm({ kind: "bag", id: bagDialog! })}
              >
                Verwijderen
              </Button>
            )}
          </div>
        </form>
        {confirm?.kind === "bag" && (
          <DeleteConfirmation
            title="Tas verwijderen?"
            description="De items blijven bestaan als Niet toegewezen."
            onCancel={() => setConfirm(null)}
            onConfirm={() => {
              void save(
                () => request(`${path}/bags/${encodeURIComponent(confirm.id)}`, "DELETE"),
                "Tas verwijderd; items zijn niet toegewezen.",
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
      <RecordDialog open={reuseOpen} title="Paklijst hergebruiken" onDismiss={() => setReuseOpen(false)}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (reuseMode === "copy" ? !sourceId : !templateIds.length) return;
            void save(async () => {
              const created = await request<PackingList>(base, "POST", {
                name: reuseName.trim(),
                ...(reuseMode === "copy" ? { copy_from_list_id: sourceId } : { template_ids: templateIds }),
              });
              setChosenList(created.id);
              setUnsaved({});
            }, "Paklijst hergebruikt; alle items zijn uitgepakt.").then((ok) => {
              if (ok) setReuseOpen(false);
            });
          }}
        >
          <ChoiceGroup
            label="Bron"
            value={reuseMode}
            choices={[
              { value: "copy", label: "Andere paklijst" },
              { value: "templates", label: "Sjablonen" },
            ]}
            onChange={setReuseMode}
          />
          {reuseMode === "copy" ? (
            <Field>
              <FieldLabel className="block">Paklijst</FieldLabel>
              <SearchSelect ariaLabel="Bronpaklijst" value={sourceId} onChange={setSourceId}>
                <option value="">Kies een paklijst…</option>
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
              <FieldLegend>Sjablonen kiezen</FieldLegend>
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
                    aria-label={`${template.name} verwijderen`}
                    onClick={() => setTemplateToDelete(template.id)}
                  >
                    Verwijderen
                  </Button>
                </div>
              ))}
            </FieldSet>
          )}
          {(sourcesQuery.isError || templatesQuery.isError) && (
            <p role="alert">Bronnen laden mislukt. Sluit en open opnieuw om te proberen.</p>
          )}
          <Field className="contents">
            <FieldLabel className="block">
              Naam nieuwe paklijst
              <Input
                required
                maxLength={160}
                value={reuseName}
                onChange={(event) => setReuseName(event.target.value)}
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <p className="text-sm">
            Tassen, volgorde, categorieën, aantallen, notities en toewijzingen blijven bewaard. Alle items beginnen
            uitgepakt.
          </p>
          <Button
            type="submit"
            disabled={busy || !reuseName.trim() || (reuseMode === "copy" ? !sourceId : !templateIds.length)}
          >
            Nieuwe paklijst maken
          </Button>
        </form>
        {templateToDelete && (
          <DeleteConfirmation
            title="Sjabloon verwijderen?"
            onCancel={() => setTemplateToDelete(null)}
            onConfirm={() => {
              void save(
                () => request(`/api/packing-templates/${encodeURIComponent(templateToDelete)}`, "DELETE"),
                "Sjabloon verwijderd.",
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
      <RecordDialog open={templateName !== null} title="Als sjabloon bewaren" onDismiss={() => setTemplateName(null)}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!templateName?.trim()) return;
            void save(
              () => request(`${path}/templates`, "POST", { name: templateName.trim() }),
              "Sjabloon bewaard.",
            ).then((ok) => {
              if (ok) setTemplateName(null);
            });
          }}
        >
          <Field className="contents">
            <FieldLabel className="block">
              Naam sjabloon
              <Input
                autoFocus
                required
                maxLength={160}
                value={templateName ?? ""}
                onChange={(event) => setTemplateName(event.target.value)}
                className="block w-full rounded border p-2"
              />
            </FieldLabel>
          </Field>
          <Button type="submit" disabled={busy || !templateName?.trim()}>
            Bewaren
          </Button>
        </form>
      </RecordDialog>
    </section>
  );
}
