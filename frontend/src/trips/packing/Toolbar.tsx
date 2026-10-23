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
          label={m.assets_group()}
          value={group}
          choices={[
            { value: "bag", label: m.assets_by_bag() },
            { value: "category", label: m.assets_by_category() },
          ]}
          onChange={onGroup}
        />
        <ChoiceGroup<Filter>
          label={m.assets_show()}
          value={filter}
          choices={[
            { value: "all", label: m.assets_all() },
            { value: "unpacked", label: m.assets_unpacked() },
            { value: "packed", label: m.assets_packed() },
            { value: "last-minute", label: m.assets_departure_day() },
          ]}
          onChange={onFilter}
        />
        <Field className="contents">
          <FieldLabel>
            {m.owner_search()}{" "}
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
          <span>{m.assets_selected_line({ p0: selected.length })}</span>
          <Button type="button" disabled={busy || !selected.length} onClick={() => void bulk(true)}>
            {m.owner_packing()}
          </Button>
          <Button
            type="button"
            disabled={busy || !selected.length}
            onClick={() => void bulk(false)}
          >
            {m.assets_unpack()}
          </Button>
          <Field>
            <FieldLabel>{m.assets_move_to()} </FieldLabel>
            <SearchSelect
              ariaLabel={m.assets_move_selected_items_to()}
              value=""
              isDisabled={busy || !selected.length}
              onChange={(value) => {
                if (value) void bulk(undefined, value === "unassigned" ? null : value);
              }}
            >
              <option value="">{m.assets_choose_bag()}</option>
              <option value="unassigned">{m.assets_unassigned()}</option>
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
            {m.assets_done()}
          </Button>
        </div>
      )}
      {hasItems && (
        <div className="flex flex-wrap gap-2">
          {!selecting && (
            <Button type="button" className="secondary compact" onClick={() => onSelecting(true)}>
              {m.assets_select_items()}
            </Button>
          )}
          <Button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => void bulk(true, undefined, true)}
          >
            {m.assets_pack_all()}
          </Button>
          <Button
            type="button"
            className="secondary compact"
            disabled={busy}
            onClick={() => void bulk(false, undefined, true)}
          >
            {m.assets_unpack_all()}
          </Button>
        </div>
      )}
    </>
  );
}
