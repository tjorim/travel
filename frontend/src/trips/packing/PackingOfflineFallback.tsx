import { Button } from "@base-ui/react/button";
import type { UseQueryResult } from "@tanstack/react-query";

import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import type { useOfflineCopies } from "../../offline/useOfflineCopies";
import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { Field, FieldLabel } from "../../ui/field";
import { PackingOfflineView } from "../PackingOfflineView";
import type { Bag, Item, PackingList } from "./model";

type Offline = ReturnType<typeof useOfflineCopies>;

/** What the packing tab shows while offline or when the lists cannot be read: the saved view-only copy, if any. */
export function PackingOfflineFallback({
  offline,
  savedCopies,
  savedCopy,
  listsQuery,
  bagsQuery,
  itemsQuery,
  onChoose,
  onRetry,
}: {
  offline: Offline;
  savedCopies: Offline["copies"];
  savedCopy: Offline["copies"][number] | undefined;
  listsQuery: UseQueryResult<PackingList[]>;
  bagsQuery: UseQueryResult<Bag[]>;
  itemsQuery: UseQueryResult<Item[]>;
  onChoose: (id: string) => void;
  onRetry: () => void;
}) {
  useLocale();
  return (
    <section className="space-y-4" aria-labelledby="packing-title">
      <h3 id="packing-title" className="text-2xl font-semibold">
        {m.owner_packing()}
      </h3>
      {savedCopies.length > 1 && (
        <Field>
          <FieldLabel className="block">{m.assets_offline_packing_list()} </FieldLabel>
          <SearchSelect
            ariaLabel={m.assets_offline_packing_list()}
            value={savedCopy?.resourceId ?? ""}
            onChange={onChoose}
          >
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
            ? errorMessage(listsQuery.error, m.assets_loading_packing_lists_failed)
            : offline.online && (bagsQuery.isError || itemsQuery.isError)
              ? m.assets_loading_packing_list_failed_2()
              : offline.loaded
                ? m.assets_no_offline_packing_list_saved_for_this_trip_reconnect_to_save_one()
                : m.assets_loading_offline_packing_lists()}
        </p>
      )}
      {offline.online && (
        <Button type="button" onClick={onRetry}>
          {m.retry()}
        </Button>
      )}
    </section>
  );
}
