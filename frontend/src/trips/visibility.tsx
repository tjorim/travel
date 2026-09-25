import { useState } from "react";

import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation } from "../query/owner-queries";
import type { ShareScopeKind, Visibility } from "../tracker-model";

/** Who receives a record. The same three choices apply to everything that can be shared. */
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Privé — alleen ik",
  everyone: "Iedereen — alle bezoekers",
  custom: "Zelf kiezen in Delen",
};

const SHORT_LABELS: Record<Visibility, string> = { private: "Privé", everyone: "Iedereen", custom: "Eigen keuze" };

/** The short form for a list row, such as "Privé". */
export const visibilityLabel = (visibility: Visibility): string => SHORT_LABELS[visibility];

/** One request sets the choice for any kind, then refreshes everything on the trip, scopes included. */
export function useSetVisibility(tripId: string) {
  return useOwnerMutation<{ kind: ShareScopeKind; id: string; visibility: Visibility }, { visibility: Visibility }>({
    fallback: "De zichtbaarheid kon niet worden bewaard.",
    request: ({ kind, id, visibility }) => ({ path: tripPath(tripId, `visibility/${kind}/${encodeURIComponent(id)}`), method: "PUT", body: { visibility } }),
    invalidate: (subject) => [ownerKeys.trip(subject, tripId), ownerKeys.trips(subject)],
  });
}

/**
 * The one control for who sees a record. It saves at once, so it works the same in an item's own
 * editor and in Delen. The server says when a record cannot be shared yet, and that is shown here.
 */
export function VisibilityControl({ tripId, kind, id, value, name, followsUpdate }: {
  tripId: string;
  kind: ShareScopeKind;
  id: string;
  value: Visibility;
  /** What the owner calls this record, so the control has an accessible name. */
  name: string;
  /** A photo attached to a reisupdate is shared with it, so it has no choice of its own. */
  followsUpdate?: string;
}) {
  const save = useSetVisibility(tripId);
  const [error, setError] = useState<string | null>(null);
  if (followsUpdate) return <p className="help visibility-control">Wordt gedeeld samen met reisupdate “{followsUpdate}”.</p>;
  const shown = save.isPending && save.variables ? save.variables.visibility : value;
  function choose(visibility: Visibility) {
    setError(null);
    save.mutateAsync({ kind, id, visibility }).catch((failure: unknown) => setError(errorMessage(failure, "De zichtbaarheid kon niet worden bewaard.")));
  }
  return <div className="field visibility-control">
    <label>Zichtbaarheid
      <select aria-label={`Zichtbaarheid van ${name}`} value={shown} disabled={save.isPending} onChange={(event) => choose(event.target.value as Visibility)}>
        {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((option) => <option key={option} value={option}>{VISIBILITY_LABELS[option]}</option>)}
      </select>
    </label>
    {error && <span className="field-error" role="alert">{error}</span>}
  </div>;
}
