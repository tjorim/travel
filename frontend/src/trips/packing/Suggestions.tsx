import { Button } from "@base-ui/react/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { useOwner } from "../../query/owner-queries";
import type { PackingSuggestion } from "./model";

/** Items the owner packed on earlier trips, offered once and dismissible per list. */
export function Suggestions({
  show,
  listId,
  path,
  queryKey,
  onAdd,
}: {
  show: boolean;
  listId: string;
  path: string;
  queryKey: unknown[];
  onAdd: (suggestion: PackingSuggestion) => void;
}) {
  useLocale();
  const owner = useOwner();
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const suggestionsQuery = useQuery({
    queryKey: [...queryKey, listId, "suggestions"],
    enabled: !!owner && show,
    queryFn: () =>
      ownerRequest<PackingSuggestion[]>(
        owner!.session,
        `${path}/suggestions`,
        m.assets_loading_suggestions_failed,
      ),
  });
  return (
    <>
      {show && (
        <section
          aria-label={m.assets_suggestions_from_earlier_trips()}
          className="space-y-2 rounded-xl border p-4"
        >
          <h4 className="font-semibold">{m.assets_you_might_want_to_bring()}</h4>
          {suggestionsQuery.isPending && <p>{m.assets_loading_suggestions()}</p>}
          {suggestionsQuery.isError && (
            <p role="alert">
              {m.assets_loading_suggestions_failed()}{" "}
              <Button type="button" onClick={() => void suggestionsQuery.refetch()}>
                {m.retry()}
              </Button>
            </p>
          )}
          {suggestionsQuery.data
            ?.filter(
              (suggestion) => !dismissedSuggestions.includes(`${listId}:${suggestion.label}`),
            )
            .map((suggestion) => (
              <div
                key={suggestion.label}
                className="flex flex-wrap items-center gap-2 border-t py-2"
              >
                <p className="flex-1">
                  {m.assets_suggestion_summary({
                    name: suggestion.label,
                    trips: m.assets_prior_trips({ count: suggestion.prior_trips }),
                    cabin: suggestion.usually_cabin ? m.assets_usually_in_cabin_baggage() : "",
                    essential: suggestion.usually_essential ? m.assets_usually_essential() : "",
                  })}
                </p>
                <Button
                  type="button"
                  className="secondary compact"
                  onClick={() => onAdd(suggestion)}
                >
                  {m.assets_add()}
                </Button>
                <Button
                  type="button"
                  className="secondary compact"
                  onClick={() =>
                    setDismissedSuggestions((current) => [
                      ...current,
                      `${listId}:${suggestion.label}`,
                    ])
                  }
                >
                  {m.assets_dismiss()}
                </Button>
              </div>
            ))}
          {suggestionsQuery.data?.length === 0 && (
            <p>{m.assets_no_recurring_items_to_suggest_yet()}</p>
          )}
        </section>
      )}
    </>
  );
}
