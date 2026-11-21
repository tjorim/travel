import { useOfflineCopies } from "@/hooks/useOfflineCopies";
import { m } from "../../paraglide/messages.js";
import { errorNotice, textNotice, type ReportNotice } from "@/lib/api/feedback";
import { visitTitle } from "@/lib/records";
import type { Visit } from "../../api-types";

/** Saving a visit on this device, or removing the copy; the result is reported through `onNotice`. */
export function useVisitOffline(tripId: string, onNotice: ReportNotice) {
  const offline = useOfflineCopies();

  async function toggleOffline(visit: Visit) {
    if (offline.isPinned("visit", visit.id)) {
      await offline.removeByResource("visit", visit.id);
      onNotice(
        textNotice(() => m.common_is_no_longer_available_offline({ title: visitTitle(visit) })),
      );
      return;
    }
    await offline.pin({
      resourceKind: "visit",
      contentMetadata: visit,
      resourceId: visit.id,
      metadataUrl: `/api/trips/${tripId}/visits/${visit.id}`,
      title: visitTitle(visit),
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(visit)).buffer as ArrayBuffer,
    });
    onNotice(
      textNotice(() => m.common_is_saved_offline_on_this_device({ title: visitTitle(visit) })),
    );
  }

  return {
    isPinned: (visit: Visit) => offline.isPinned("visit", visit.id),
    toggle: (visit: Visit) =>
      void toggleOffline(visit).catch((error: unknown) =>
        onNotice(errorNotice(error, m.visits_the_visit_could_not_be_saved_offline)),
      ),
  };
}
