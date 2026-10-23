import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { Field, FieldLabel } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { count, grams, type Bag, type Group, type Item } from "./model";

/** The items, grouped by bag or category, each row with its packed checkbox (or selection box) and edit action. */
export function ItemSections({
  bags,
  items,
  visible,
  group,
  selecting,
  selected,
  onSelected,
  savingIds,
  unsaved,
  onToggle,
  onStartItem,
  onStartBag,
}: {
  bags: Bag[];
  items: Item[];
  visible: Item[];
  group: Group;
  selecting: boolean;
  selected: string[];
  onSelected: (update: (current: string[]) => string[]) => void;
  savingIds: string[];
  unsaved: Record<string, boolean>;
  onToggle: (item: Item, packed?: boolean) => void;
  onStartItem: (item?: Item, bagId?: string | null) => void;
  onStartBag: (bag?: Bag) => void;
}) {
  const locale = useLocale();
  const sections =
    group === "bag"
      ? [
          ...bags.map((bag) => ({ id: bag.id, title: bag.name, bag })),
          { id: "unassigned", title: m.assets_unassigned(), bag: null },
        ]
      : [...new Set(visible.map((item) => item.category?.trim() || ""))]
          .sort((a, b) => a.localeCompare(b, locale))
          .map((category) => ({
            id: category,
            title: category || m.assets_uncategorised(),
            bag: null,
          }));
  return (
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
          <section
            key={section.id}
            className="rounded-xl border p-3 sm:p-4"
            aria-label={section.title}
          >
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
                      onClick={() => onStartItem(undefined, section.bag?.id ?? null)}
                    >
                      {m.assets_quick_add()}
                    </Button>
                    {section.bag && (
                      <Button
                        type="button"
                        className="secondary compact"
                        onClick={() => onStartBag(section.bag!)}
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
                            <span className="sr-only">
                              {m.assets_select_line({ p0: item.label })}
                            </span>
                            <TravelCheckbox
                              className="size-6"
                              checked={selected.includes(item.id)}
                              onCheckedChange={(checked) =>
                                onSelected((current) =>
                                  checked
                                    ? [...current, item.id]
                                    : current.filter((id) => id !== item.id),
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
                              onCheckedChange={() => onToggle(item)}
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
                              ? (bags.find((bag) => bag.id === item.bag_id)?.name ??
                                m.assets_unassigned())
                              : null,
                            item.weight_g !== null
                              ? m.assets_per_item({ p0: grams(item.weight_g) })
                              : null,
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
                          <Button type="button" onClick={() => onToggle(item, unsaved[item.id])}>
                            {m.assets_try_again_line({ p0: item.label })}
                          </Button>
                        )}
                      </div>
                      {!selecting && (
                        <Button
                          type="button"
                          className="secondary compact shrink-0"
                          aria-label={m.assets_edit({ p0: item.label })}
                          onClick={() => onStartItem(item)}
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
  );
}
