import { useState } from "react";
import { Button } from "@/ui/button";
import { Field, FieldLabel } from "@/ui/field";
import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { useOfflineCopies } from "../../offline/useOfflineCopies";
import { m } from "../../paraglide/messages.js";
import { bytesLabel, formatInstant } from "../../tracker-model";
import { PackingOfflineView } from "../PackingOfflineView";

/** This reader needs only the route id, never a cached live trip response or an editor chunk. */
export function PackingTripOffline({ tripId, onRetry }: { tripId: string; onRetry: () => void }) {
  useLocale();
  const offline = useOfflineCopies();
  const [chosen, setChosen] = useState("");
  const prefix = `/api/trips/${encodeURIComponent(tripId)}/packing-lists/`;
  const copies = offline.copies.filter(
    (copy) => copy.resourceKind === "packing_list" && copy.metadataUrl.startsWith(prefix),
  );
  const copy = copies.find((candidate) => candidate.id === chosen) ?? copies[0];
  return (
    <section className="grid gap-4" aria-labelledby="packing-title">
      <h2 id="packing-title" className="text-2xl font-semibold">
        {m.owner_packing()}
      </h2>
      <p role="status">{m.packing_trip_metadata_unavailable()}</p>
      {copies.length > 1 && (
        <Field>
          <FieldLabel>{m.assets_offline_packing_list()}</FieldLabel>
          <SearchSelect
            ariaLabel={m.assets_offline_packing_list()}
            value={copy?.id ?? ""}
            onChange={setChosen}
          >
            {copies.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </SearchSelect>
        </Field>
      )}
      {copy ? (
        <div key={`${offline.subject}:${copy.id}`} className="grid gap-3">
          <h3 className="text-xl font-semibold">{copy.title}</h3>
          <p>
            {m.assets_last_checked_valid_until_line({
              p0: m.assets_packing_list(),
              p1: bytesLabel(copy.byteSize),
              p2: formatInstant(copy.lastValidatedAt),
              p3: formatInstant(copy.leaseExpiresAt),
            })}
          </p>
          {copy.newerVersionAvailable && (
            <p role="status">{m.assets_offline_newer_version_available()}</p>
          )}
          <PackingOfflineView copy={copy} open={offline.open} />
        </div>
      ) : (
        <p role="status">
          {offline.unsupported
            ? m.assets_offline_storage_is_not_supported_in_this_browser()
            : !offline.loaded
              ? m.assets_loading_offline_packing_lists()
              : m.packing_no_valid_offline_copy()}
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
