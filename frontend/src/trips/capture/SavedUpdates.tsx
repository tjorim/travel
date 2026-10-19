import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { formatInstant, type TravelUpdate } from "../../tracker-model";

/** The trip's saved travel updates, newest first; choosing one loads it into the editor. */
export function SavedUpdates({
  updates,
  onEdit,
}: {
  updates: TravelUpdate[];
  onEdit: (update: TravelUpdate) => void;
}) {
  useLocale();
  return (
    <section className="saved-records">
      <h3>{m.owner_saved_travel_updates()}</h3>
      {updates
        .slice()
        .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at))
        .map((update) => (
          <Button
            className="grid w-full gap-0.75 border border-travel-card-border bg-travel-surface p-3.5 text-left text-travel-ink shadow-sm [&_span]:text-sm [&_span]:font-medium [&_span]:text-travel-muted"
            type="button"
            key={update.id}
            onClick={() => onEdit(update)}
          >
            <strong>{update.title}</strong>
            <span>
              {formatInstant(update.occurred_at)}
              {update.location ? ` · ${update.location.display_name}` : m.owner_without_location()}
            </span>
          </Button>
        ))}
    </section>
  );
}
