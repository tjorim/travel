import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { PackingProgress } from "./PackingProgress";
import { bagTypes, count, grams, type Bag, type Item } from "./model";

/** One card per bag: its progress, known weight and whether it is over its limit. */
export function BagSummaries({ bags, items }: { bags: Bag[]; items: Item[] }) {
  useLocale();
  return (
    <div
      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={m.assets_progress_per_bag()}
    >
      {bags.map((bag) => {
        const rows = items.filter((item) => item.bag_id === bag.id);
        const known = rows.reduce((sum, item) => sum + (item.weight_g ?? 0) * item.quantity, 0);
        const unknown = rows.some((item) => item.weight_g === null);
        return (
          <div key={bag.id} className="rounded-xl border p-3">
            <strong>{bag.name}</strong>
            {bag.type && (
              <p className="text-sm">
                {bagTypes().find(([type]) => type === bag.type)?.[1] ?? bag.type}
              </p>
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
  );
}
