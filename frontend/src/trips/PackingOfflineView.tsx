import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { errorNotice, useFeedback, FeedbackError, textNotice } from "../query/feedback";
import { TravelCheckbox } from "../ui/TravelCheckbox";
import { Input } from "@base-ui/react/input";
import { useEffect, useRef, useState } from "react";
import { ChoiceGroup } from "../ui/ChoiceGroup";
import { formatInstant } from "../tracker-model";
import type { OfflineCopySummary } from "../offline/offline-store";
import { Field, FieldLabel } from "../ui/field";

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
  const locale = useLocale();
  const openRef = useRef(open);
  openRef.current = open;
  const [snapshot, setSnapshot] = useState<PackingSnapshot | null>(null);
  const [error, setError] = useFeedback<string>("");
  const [group, setGroup] = useState<"bag" | "category">("bag");
  const [filter, setFilter] = useState<"all" | "unpacked" | "packed" | "last-minute">("all");
  const [search, setSearch] = useFeedback<string>("");

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
            throw new FeedbackError(() => m.assets_the_offline_packing_list_is_invalid());
          if (active) setSnapshot(value);
        },
        (reason: unknown) => {
          if (active) setError(errorNotice(reason, m.assets_the_offline_packing_list_could_not_be_opened));
        },
      )
      .catch((reason: unknown) => {
        if (active) setError(errorNotice(reason, m.assets_the_offline_packing_list_is_invalid));
      });
    return () => {
      active = false;
    };
  }, [copy.id]);

  useEffect(() => {
    if (!copy.leaseExpiresAt) return;
    const timer = window.setTimeout(
      () => {
        setSnapshot(null);
        setError(textNotice(m.assets_the_offline_validity_period_of_this_copy_has_expired_reconnect_to_the_in));
      },
      Math.max(0, copy.leaseExpiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [copy.id, copy.leaseExpiresAt]);

  if (error) return <p role="alert">{error}</p>;
  if (!snapshot) return <p role="status">{m.assets_opening_offline_packing_list()}</p>;
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
          { id: "", title: m.assets_unassigned() },
        ]
      : [...new Set(visible.map((item) => item.category?.trim() || ""))]
          .sort((a, b) => a.localeCompare(b, locale))
          .map((category) => ({ id: category, title: category || m.assets_uncategorised() }));

  return (
    <section className="space-y-4" aria-label={m.assets_offline_packing_list_2({ p0: snapshot.list.name })}>
      <div>
        <h3 className="text-xl font-semibold">{snapshot.list.name}</h3>
        <p role="status" className="text-sm">
          {m.assets_offline_copy_saved_on_line({ p0: formatInstant(new Date(snapshot.savedAt).toISOString()) })}
        </p>
        <p className="text-sm">{m.assets_view_only_checking_off_moving_and_editing_require_a_connection()}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <ChoiceGroup
          label={m.assets_group()}
          value={group}
          choices={[
            { value: "bag", label: m.assets_by_bag() },
            { value: "category", label: m.assets_by_category() },
          ]}
          onChange={setGroup}
        />
        <ChoiceGroup
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
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded border p-2"
            />
          </FieldLabel>
        </Field>
      </div>
      {groups.map((section) => {
        const rows = visible
          .filter((item) =>
            group === "bag" ? (item.bag_id ?? "") === section.id : (item.category?.trim() || "") === section.id,
          )
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
        if (!rows.length && group === "category") return null;
        return (
          <section key={section.id} className="rounded-xl border p-3" aria-label={section.title}>
            <h4 className="font-semibold">{section.title}</h4>
            {!rows.length && <p>{m.assets_no_items_here()}</p>}
            <ul className="m-0 list-none divide-y p-0">
              {rows.map((item) => (
                <li key={item.id} className="py-2">
                  <Field className="contents">
                    <FieldLabel className="flex items-start gap-2">
                      <TravelCheckbox
                        checked={item.packed}
                        disabled
                        readOnly
                        aria-label={m.assets_packed_3({ p0: item.label })}
                      />
                      <span>
                        <strong className={item.packed ? "line-through opacity-60" : ""}>
                          {item.quantity > 1 ? `${item.quantity} × ` : ""}
                          {item.label}
                        </strong>
                        <span className="block text-sm opacity-70">
                          {item.category || m.assets_uncategorised()}
                          {group === "category"
                            ? ` · ${snapshot.bags.find((bag) => bag.id === item.bag_id)?.name ?? m.assets_unassigned()}`
                            : ""}
                        </span>
                        {item.notes && <span className="block text-sm">{item.notes}</span>}
                      </span>
                    </FieldLabel>
                  </Field>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!visible.length && <p>{m.assets_no_items_for_this_filter()}</p>}
    </section>
  );
}
