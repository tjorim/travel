import { LinkedLibraryDocuments } from "../library/LinkedLibraryDocuments";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { useLinkedLibraryDocuments, useTripResource } from "../query/owner-queries";
import { DocumentManager } from "./DocumentManager";
import { HomeLink } from "./HomeLink";
import { focusFor } from "./record-focus";
import { SectionAccordion } from "./SectionAccordion";
import { TripTaskManager } from "./TripTaskManager";
import { useOpenSections } from "./use-open-sections";
import { partsOf, type SectionProps } from "./workspace-sections";

const PARTS = partsOf("prepare");

/** The workspace's preparation tab: what to arrange and the documents to carry. */
export default function PrepareSection({ trip, recordFocus }: SectionProps) {
  useLocale();
  const { isOpen, setOpen } = useOpenSections(PARTS, recordFocus);
  const tasks = useTripResource(trip.id, "trip-tasks").data;
  const documents = useTripResource(trip.id, "documents").data;
  // The linked-documents card has its own link to the library; without one the section still points there.
  const linkedDocuments = useLinkedLibraryDocuments(trip.id).data;
  const [tasksPart, documentsPart] = PARTS;
  return (
    <>
      <SectionAccordion
        id={tasksPart.id}
        title={tasksPart.label()}
        count={tasks?.filter((task) => !task.completed_at).length}
        open={isOpen(tasksPart.id)}
        onOpenChange={(value) => setOpen(tasksPart.id, value)}
      >
        <TripTaskManager trip={trip} focusId={focusFor(recordFocus, "task")} />
      </SectionAccordion>
      <SectionAccordion
        id={documentsPart.id}
        title={documentsPart.label()}
        count={documents?.length}
        open={isOpen(documentsPart.id)}
        onOpenChange={(value) => setOpen(documentsPart.id, value)}
      >
        <DocumentManager trip={trip} focusId={focusFor(recordFocus, "document")} />
        <LinkedLibraryDocuments tripId={trip.id} />
        {!linkedDocuments?.length && <HomeLink to="/library">{m.common_go_to_library()}</HomeLink>}
      </SectionAccordion>
    </>
  );
}
