import { useLocale } from "../locale";
import { useTripResource } from "../query/owner-queries";
import { MediaManager } from "./MediaManager";
import { focusFor } from "./record-focus";
import { SectionAccordion } from "./SectionAccordion";
import { TravelUpdateManager } from "./TravelUpdateManager";
import { useOpenSections } from "./use-open-sections";
import { partsOf, type SectionProps } from "./workspace-sections";

const PARTS = partsOf("story");

/** The workspace's story tab: the travel updates and the photos and videos that belong to them. */
export default function StorySection({
  trip,
  areas,
  recordFocus,
  onStartCaptureFromCandidate,
}: SectionProps) {
  useLocale();
  const { isOpen, setOpen } = useOpenSections(PARTS, recordFocus);
  const media = useTripResource(trip.id, "media").data;
  const [updatesPart, mediaPart] = PARTS;
  return (
    <>
      <SectionAccordion
        id={updatesPart.id}
        title={updatesPart.label()}
        count={trip.travel_updates.length}
        open={isOpen(updatesPart.id)}
        onOpenChange={(value) => setOpen(updatesPart.id, value)}
      >
        <TravelUpdateManager trip={trip} areas={areas} focusId={focusFor(recordFocus, "update")} />
      </SectionAccordion>
      <SectionAccordion
        id={mediaPart.id}
        title={mediaPart.label()}
        count={media?.length}
        open={isOpen(mediaPart.id)}
        onOpenChange={(value) => setOpen(mediaPart.id, value)}
      >
        <MediaManager
          trip={trip}
          onStartCaptureFromCandidate={onStartCaptureFromCandidate}
          focusId={focusFor(recordFocus, "media")}
        />
      </SectionAccordion>
    </>
  );
}
