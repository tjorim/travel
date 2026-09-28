import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Input } from "@base-ui/react/input";
import { useEffect, useRef, useState } from "react";
import { ChoiceGroup } from "../ui/ChoiceGroup";
import { formatInstant } from "../tracker-model";
import type { OfflineCopySummary } from "../offline/offline-store";

export type PackingSnapshot = {
  list: { id: string; name: string };
  bags: { id: string; name: string; position: number }[];
  items: {
    id: string;
    label: string;
    quantity: number;
    category: string | null;
    bag_id: string | null;
    position: number;
    packed: boolean;
    notes: string | null;
    last_minute: boolean;
  }[];
  savedAt: number;
};

export function PackingOfflineView({ copy, open }: { copy: OfflineCopySummary; open: (id: string) => Promise<Blob> }) {
  const openRef = useRef(open);
  openRef.current = open;
  const [snapshot, setSnapshot] = useState<PackingSnapshot | null>(null);
  const [error, setError] = useState("");
  const [group, setGroup] = useState<"bag" | "category">("bag");
  const [filter, setFilter] = useState<"all" | "unpacked" | "packed" | "last-minute">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setError("");
    void openRef
      .current(copy.id)
      .then(
        async (blob) => {
          const value = JSON.parse(await blob.text()) as PackingSnapshot;
          if (!value.list || !Array.isArray(value.bags) || !Array.isArray(value.items) || !value.savedAt)
            throw new Error("De offline paklijst is ongeldig.");
          if (active) setSnapshot(value);
        },
        (reason: unknown) => {
          if (active)
            setError(reason instanceof Error ? reason.message : "De offline paklijst kon niet worden geopend.");
        },
      )
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "De offline paklijst is ongeldig.");
      });
    return () => {
      active = false;
    };
  }, [copy.id]);

  if (error) return <p role="alert">{error}</p>;
  if (!snapshot) return <p role="status">Offline paklijst openen…</p>;
  const visible = snapshot.items.filter(
    (item) =>
      (filter === "all" || (filter === "last-minute" ? item.last_minute : item.packed === (filter === "packed"))) &&
      `${item.label} ${item.category ?? ""} ${item.notes ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const groups =
    group === "bag"
      ? [
          ...[...snapshot.bags].sort((a, b) => a.position - b.position).map((bag) => ({ id: bag.id, title: bag.name })),
          { id: "", title: "Niet toegewezen" },
        ]
      : [...new Set(visible.map((item) => item.category?.trim() || "Zonder categorie"))]
          .sort((a, b) => a.localeCompare(b, "nl"))
          .map((title) => ({ id: title, title }));

  return (
    <section className="space-y-4" aria-label={`Offline paklijst ${snapshot.list.name}`}>
      <div>
        <h3 className="text-xl font-semibold">{snapshot.list.name}</h3>
        <p role="status" className="text-sm">
          Offline kopie · bewaard op {formatInstant(new Date(snapshot.savedAt).toISOString())}
        </p>
        <p className="text-sm">Alleen bekijken. Voor afvinken, verplaatsen en bewerken is een verbinding nodig.</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <ChoiceGroup
          label="Groeperen"
          value={group}
          choices={[
            { value: "bag", label: "Per tas" },
            { value: "category", label: "Per categorie" },
          ]}
          onChange={setGroup}
        />
        <ChoiceGroup
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
        <label>
          Zoeken{" "}
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded border p-2"
          />
        </label>
      </div>
      {groups.map((section) => {
        const rows = visible
          .filter((item) =>
            group === "bag"
              ? (item.bag_id ?? "") === section.id
              : (item.category?.trim() || "Zonder categorie") === section.id,
          )
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
        if (!rows.length && group === "category") return null;
        return (
          <section key={section.id} className="rounded-xl border p-3" aria-label={section.title}>
            <h4 className="font-semibold">{section.title}</h4>
            {!rows.length && <p>Geen items hier.</p>}
            <ul className="divide-y">
              {rows.map((item) => (
                <li key={item.id} className="py-2">
                  <label className="flex items-start gap-2">
                    <TravelCheckbox checked={item.packed} disabled readOnly aria-label={`${item.label} ingepakt`} />
                    <span>
                      <strong className={item.packed ? "line-through opacity-60" : ""}>
                        {item.quantity > 1 ? `${item.quantity} × ` : ""}
                        {item.label}
                      </strong>
                      <span className="block text-sm opacity-70">
                        {item.category || "Zonder categorie"}
                        {group === "category"
                          ? ` · ${snapshot.bags.find((bag) => bag.id === item.bag_id)?.name ?? "Niet toegewezen"}`
                          : ""}
                      </span>
                      {item.notes && <span className="block text-sm">{item.notes}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!visible.length && <p>Geen items voor deze filter.</p>}
    </section>
  );
}
