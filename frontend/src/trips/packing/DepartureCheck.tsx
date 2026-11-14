import { Button } from "@/ui/button";
import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { count, grams, type Bag, type Item } from "./model";

/** A collapsible checklist of what is still to pack, or inconsistent, before leaving. */
export function DepartureCheck({ bags, items }: { bags: Bag[]; items: Item[] }) {
  useLocale();
  const [leavingSoon, setLeavingSoon] = useState(false);
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
  return (
    <>
      <Button
        type="button"
        className="secondary compact"
        aria-expanded={leavingSoon}
        onClick={() => setLeavingSoon(!leavingSoon)}
      >
        {m.packing_departure_check()}
      </Button>
      {leavingSoon && (
        <section
          aria-label={m.packing_departure_check()}
          className="space-y-3 rounded-xl border p-4"
        >
          <h4 className="text-lg font-semibold">{m.packing_departure_check()}</h4>
          <p>{count(items)}</p>
          <ul className="m-0 list-none space-y-1 p-0">
            {bags.map((bag) => {
              const rows = items.filter((item) => item.bag_id === bag.id);
              const known = rows.reduce(
                (sum, item) => sum + (item.weight_g ?? 0) * item.quantity,
                0,
              );
              return (
                <li key={bag.id}>
                  {m.packing_departure_bag_line({
                    bag: bag.name,
                    count: count(rows),
                    weight: grams(known),
                    limit: bag.weight_limit_g
                      ? m.packing_limit({ limit: grams(bag.weight_limit_g) })
                      : "",
                    note: rows.some((item) => item.weight_g === null)
                      ? m.packing_weight_incomplete()
                      : "",
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
            !overweight.length && <p className="font-semibold">{m.packing_ready_to_leave()}</p>}
          {!!unpackedEssentials.length && (
            <p>
              {m.packing_departure_essentials({
                items: unpackedEssentials.map((item) => item.label).join(", "),
              })}
            </p>
          )}
          {!!unpackedLastMinute.length && (
            <p>
              {m.packing_departure_last_minute({
                items: unpackedLastMinute.map((item) => item.label).join(", "),
              })}
            </p>
          )}
          {!!unassigned.length && (
            <p>
              {m.packing_departure_unassigned({
                items: unassigned.map((item) => item.label).join(", "),
              })}
            </p>
          )}
          {!!overweight.length && (
            <p>
              {m.packing_weight_over_limit_hint({
                bags: overweight.map((bag) => bag.name).join(", "),
              })}
            </p>
          )}
          {!!conflicts.length && (
            <p>
              {m.packing_departure_conflicts({
                items: conflicts.map((item) => item.label).join(", "),
              })}
            </p>
          )}
          <p className="text-sm">{m.packing_baggage_flags_hint()}</p>
        </section>
      )}
    </>
  );
}
