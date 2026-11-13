import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { AsyncSearchSelect } from "../../forms/fields";
import type { TripSummary } from "../../api-types";
import { Field, FieldLabel } from "@/ui/field";

/** The trip a travel update belongs to: fixed when the dialog is locked to one, else searchable. */
export function TripChoice({
  lockedTrip,
  selectedTrip,
  draftTripId,
  trips,
  search,
  onSelect,
}: {
  lockedTrip: TripSummary | null;
  selectedTrip: TripSummary | null;
  draftTripId: string;
  trips: TripSummary[];
  search: (query: string) => Promise<TripSummary[]>;
  onSelect: (tripId: string) => void;
}) {
  useLocale();
  return lockedTrip ? (
    <p className="m-0 font-bold text-travel-forest">
      {m.owner_trip()} <strong>{lockedTrip.title}</strong>
    </p>
  ) : (
    <Field>
      <FieldLabel>{m.owner_trip_2()}</FieldLabel>
      <AsyncSearchSelect
        ariaLabel={m.owner_trip()}
        value={draftTripId}
        selectedOption={selectedTrip ? { value: selectedTrip.id, label: selectedTrip.title } : null}
        defaultOptions={trips.slice(0, 50).map((trip) => ({ value: trip.id, label: trip.title }))}
        onChange={onSelect}
        loadOptions={async (q) =>
          (await search(q)).map((trip) => ({ value: trip.id, label: trip.title }))
        }
      />
    </Field>
  );
}
