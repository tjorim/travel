import { Button } from "@/ui/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { DuplicateGroup } from "../merge-candidates";
import { reasonsText } from "../MergeDialog";

/** Likely duplicates, listed without acting on them: reviewing opens the merge preview. */
export function DuplicateSuggestions({
  title,
  groups,
  nameOf,
  onReview,
}: {
  title: string;
  groups: DuplicateGroup[];
  nameOf: (id: string) => string;
  onReview: (group: DuplicateGroup) => void;
}) {
  useLocale();
  if (!groups.length) return null;
  return (
    <section className="grid gap-2 rounded-xl border border-travel-divider bg-travel-surface p-4">
      <h4 className="m-0">{title}</h4>
      <p className="help">{m.owner_possible_duplicates_help()}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {groups.map((group) => {
          const names = group.ids.map(nameOf).join(" · ");
          return (
            <li
              className="flex flex-wrap items-center justify-between gap-2"
              key={group.ids.join()}
            >
              <span>
                {names} <span className="help">({reasonsText(group.reasons)})</span>
              </span>
              <Button
                className="secondary compact"
                type="button"
                aria-label={m.owner_review_merge_of({ p0: names })}
                onClick={() => onReview(group)}
              >
                {m.owner_review_merge()}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
