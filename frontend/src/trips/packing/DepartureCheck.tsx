import { Button } from "@base-ui/react/button";
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
        {m.assets_departure_check()}
      </Button>
      {leavingSoon && (
        <section
          aria-label={m.assets_departure_check()}
          className="space-y-3 rounded-xl border p-4"
        >
          <h4 className="text-lg font-semibold">{m.assets_departure_check()}</h4>
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
                  {m.assets_known_line({
                    p0: bag.name,
                    p1: count(rows),
                    p2: grams(known),
                    p3: bag.weight_limit_g ? m.assets_limit({ p0: grams(bag.weight_limit_g) }) : "",
                    p4: rows.some((item) => item.weight_g === null)
                      ? m.assets_weight_incomplete()
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
              {m.assets_on_departure_day_line({
                p0: unpackedLastMinute.map((item) => item.label).join(", "),
              })}
            </p>
          )}
          {!!unassigned.length && (
            <p>
              {m.assets_still_without_a_bag_line({
                p0: unassigned.map((item) => item.label).join(", "),
              })}
            </p>
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
          <p className="text-sm">
            {m.assets_baggage_flags_are_your_own_notes_not_official_travel_rules()}
          </p>
        </section>
      )}
    </>
  );
}
