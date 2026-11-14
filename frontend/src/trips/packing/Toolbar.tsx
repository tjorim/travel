import { Button } from "@/ui/button";
import { Input } from "@/ui/input";

import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ChoiceGroup } from "@/ui/ChoiceGroup";
import { Field, FieldLabel } from "@/ui/field";
import type { Bag, Filter, Group } from "./model";

/** Grouping, filtering and search, plus selecting items for a bulk pack, unpack or move. */
export function Toolbar({
  bags,
  hasItems,
  group,
  onGroup,
  filter,
  onFilter,
  search,
  onSearch,
  selecting,
  onSelecting,
  selected,
  onSelected,
  busy,
  bulk,
}: {
  bags: Bag[];
  hasItems: boolean;
  group: Group;
  onGroup: (group: Group) => void;
  filter: Filter;
  onFilter: (filter: Filter) => void;
  search: string;
  onSearch: (search: string) => void;
  selecting: boolean;
  onSelecting: (selecting: boolean) => void;
  selected: string[];
  onSelected: (selected: string[]) => void;
  busy: boolean;
  bulk: (packed?: boolean, bagId?: string | null, all?: boolean) => Promise<void>;
}) {
  useLocale();
  return (
    <>
      <div className="flex flex-wrap gap-3 rounded-xl border p-3">
        <ChoiceGroup<Group>
          label={m.packing_group()}
          value={group}
          choices={[
            { value: "bag", label: m.packing_by_bag() },
            { value: "category", label: m.packing_by_category() },
          ]}
          onChange={onGroup}
        />
        <ChoiceGroup<Filter>
          label={m.packing_show()}
          value={filter}
          choices={[
            { value: "all", label: m.packing_all() },
            { value: "unpacked", label: m.packing_unpacked() },
            { value: "packed", label: m.packing_packed() },
            { value: "last-minute", label: m.packing_departure_day() },
          ]}
          onChange={onFilter}
        />
        <Field className="contents">
          <FieldLabel>
            {m.packing_search()}{" "}
            <Input
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </FieldLabel>
        </Field>
      </div>
      {selecting && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span>{m.packing_selected_count({ count: selected.length })}</span>
          <Button type="button" disabled={busy || !selected.length} onClick={() => void bulk(true)}>
            {m.packing_packing()}
          </Button>
          <Button
            type="button"
            disabled={busy || !selected.length}
            onClick={() => void bulk(false)}
          >
            {m.packing_unpack()}
          </Button>
          <Field>
            <FieldLabel>{m.packing_move_to()} </FieldLabel>
            <SearchSelect
              ariaLabel={m.packing_move_selected_items_to()}
              value=""
              isDisabled={busy || !selected.length}
              onChange={(value) => {
                if (value) void bulk(undefined, value === "unassigned" ? null : value);
              }}
            >
              <option value="">{m.packing_choose_bag()}</option>
              <option value="unassigned">{m.packing_unassigned()}</option>
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
              onSelected([]);
              onSelecting(false);
            }}
          >
            {m.packing_done()}
          </Button>
        </div>
      )}
      {hasItems && (
        <div className="flex flex-wrap gap-2">
          {!selecting && (
            <Button type="button" className="secondary compact" onClick={() => onSelecting(true)}>
              {m.packing_select_items()}
            </Button>
          )}
          <Button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => void bulk(true, undefined, true)}
          >
            {m.packing_pack_all()}
          </Button>
          <Button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => void bulk(false, undefined, true)}
          >
            {m.packing_unpack_all()}
          </Button>
        </div>
      )}
    </>
  );
}
