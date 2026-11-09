import { saveFile } from "./save-file";
import { TripPdfExport } from "./TripPdfExport";
import { useMutation } from "@tanstack/react-query";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { ApiError, errorMessage, ownerFile } from "../query/api";
import { textNotice, type MessageNotice } from "../query/feedback";
import { useOwner } from "../query/owner-queries";
import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";

/**
 * Downloads one trip's canonical records as private JSON through the normal
 * authenticated request (no token in the URL); the bytes never enter the query cache.
 */
export function TripExport({
  tripId,
  onNotice,
}: {
  tripId: string;
  onNotice: (notice: MessageNotice) => void;
}) {
  useLocale();
  const owner = useOwner();
  const exportTrip = useMutation<void, Error>({
    mutationFn: async () => {
      if (!owner) throw new ApiError(m.assets_sign_in_to_change_your_private_trips, 401);
      const blob = await ownerFile(
        owner.session,
        `/api/trips/${encodeURIComponent(tripId)}/export`,
        m.owner_trip_export_failed,
        { cache: "no-store" },
      );
      saveFile(new Blob([blob], { type: "application/json" }), `trip-${tripId}-export.json`);
    },
    onSuccess: () => onNotice(textNotice(() => m.owner_trip_export_downloaded())),
  });

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        className="compact"
        disabled={exportTrip.isPending}
        onClick={() => exportTrip.mutate()}
      >
        {exportTrip.isPending ? (
          <>
            <Spinner /> {m.owner_exporting_trip_data()}
          </>
        ) : (
          m.owner_export_trip_data()
        )}
      </Button>
      <p className="help">{m.owner_trip_export_help()}</p>
      {exportTrip.isError && (
        <Alert variant="error" role="alert">
          {errorMessage(exportTrip.error, m.owner_trip_export_failed)}
        </Alert>
      )}
      <TripPdfExport tripId={tripId} />
    </div>
  );
}
