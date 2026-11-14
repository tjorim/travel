import { formatNumber } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type {
  Bag,
  Item,
  PackingList,
  PackingSource,
  PackingSuggestion,
  PackingTemplate,
} from "../../api-types";

export type { Bag, Item, PackingList, PackingSource, PackingSuggestion, PackingTemplate };

export type ItemDraft = Omit<Item, "id" | "list_id" | "position" | "packed">;
export type BagDraft = Pick<Bag, "name" | "type" | "weight_limit_g">;
export type Group = "bag" | "category";
export type Filter = "all" | "unpacked" | "packed" | "last-minute";
export const emptyItem = (bag_id: string | null): ItemDraft => ({
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
export const emptyBag = (): BagDraft => ({ name: "", type: null, weight_limit_g: null });
export const ordered = <T extends { position: number; id: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
export const grams = (value: number) =>
  value >= 1000
    ? `${formatNumber(value / 1000, { maximumFractionDigits: 2 })} kg`
    : `${formatNumber(value)} g`;
export const count = (rows: Item[]) => {
  const packed = rows.filter((item) => item.packed).length;
  return m.packing_of_packed_to_go({
    packed: packed,
    total: rows.length,
    remaining: rows.length - packed,
  });
};
export const bagTypes = () =>
  [
    ["cabin", m.packing_cabin_baggage()],
    ["checked", m.packing_checked_baggage()],
    ["day", m.packing_day_or_overnight_bag()],
    ["person", m.packing_on_your_person()],
    ["other", m.packing_other()],
  ] as const;

/** Runs a packing write, refreshes the lists afterwards and reports whether it succeeded. */
export type PackingSave = (
  action: () => Promise<unknown>,
  success: () => string,
) => Promise<boolean>;
export type PackingRequest = <T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
) => Promise<T>;
/** The record a delete confirmation inside the item or bag dialog is asking about. */
export type PendingDelete = { kind: "item" | "bag"; id: string } | null;
