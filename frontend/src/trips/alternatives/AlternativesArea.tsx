import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { useTripResource } from "../../query/owner-queries";
import type { AlternativeKind } from "../../api-types";
import { AlternativesPanel, hasAlternatives } from "./AlternativesPanel";
import { useAlternativeQueries } from "./use-alternatives";

const KINDS: {
  kind: AlternativeKind;
  resource: "visits" | "stays" | "routes";
  label: () => string;
}[] = [
  { kind: "visit", resource: "visits", label: () => m.common_visits() },
  { kind: "stay", resource: "stays", label: () => m.common_stays() },
  { kind: "route", resource: "routes", label: () => m.common_routes() },
];

/**
 * The alternatives of every kind in one place above the timeline: one title and one help text, then a panel for each
 * kind that has groups, suggestions or loose records to compare. Nothing is shown while there is nothing to compare.
 */
export function AlternativesArea({
  tripId,
  onOpen,
}: {
  tripId: string;
  onOpen: (kind: AlternativeKind, id: string) => void;
}) {
  useLocale();
  const { groups, suggestions } = useAlternativeQueries(tripId);
  const visits = useTripResource(tripId, "visits").data;
  const stays = useTripResource(tripId, "stays").data;
  const routes = useTripResource(tripId, "routes").data;
  const records = { visits: visits ?? [], stays: stays ?? [], routes: routes ?? [] };
  const failed = groups.error ?? suggestions.error;

  const shown = KINDS.filter(({ kind, resource }) =>
    hasAlternatives(
      records[resource],
      (groups.data ?? []).filter((group) => group.kind === kind),
      (suggestions.data ?? []).filter((item) => item.kind === kind),
    ),
  );
  if (!failed && shown.length === 0) return null;

  return (
    <section className="grid gap-2" aria-labelledby="alternatives-title">
      <h4 id="alternatives-title" className="m-0">
        {m.alternatives_heading()}
      </h4>
      <p className="help">{m.alternatives_help()}</p>
      {failed && (
        <p role="alert">
          {errorMessage(failed, m.alternatives_your_alternatives_could_not_be_loaded)}
        </p>
      )}
      {KINDS.map(({ kind, resource, label }) => (
        <AlternativesPanel
          key={kind}
          tripId={tripId}
          kind={kind}
          records={records[resource]}
          heading={label()}
          onOpen={(id) => onOpen(kind, id)}
        />
      ))}
    </section>
  );
}
