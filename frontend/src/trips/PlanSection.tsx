import { useLocale } from "../locale";
import { useTripResource } from "../query/owner-queries";
import { AgendaView } from "./AgendaView";
import { AreaManager } from "./AreaManager";
import { focusFor } from "./record-focus";
import { RouteManager } from "./RouteManager";
import { SectionAccordion } from "./SectionAccordion";
import { StayManager } from "./StayManager";
import { useOpenSections } from "./use-open-sections";
import { VisitManager } from "./VisitManager";
import { partsOf, type SectionProps } from "./workspace-sections";

const PARTS = partsOf("plan");

/** The workspace's planning tab: its editors load together, on first opening it, each in a collapsible block. */
export default function PlanSection({
  trip,
  areas,
  recordFocus,
  onOpenAgendaRecord,
  onShowOnMap,
}: SectionProps) {
  useLocale();
  const { isOpen, setOpen } = useOpenSections(PARTS, recordFocus);
  const visits = useTripResource(trip.id, "visits").data;
  const stays = useTripResource(trip.id, "stays").data;
  const routes = useTripResource(trip.id, "routes").data;
  const counts: Record<string, number | undefined> = {
    areas: areas.length,
    visits: visits?.length,
    stays: stays?.length,
    routes: routes?.length,
  };
  const block = (id: string, children: React.ReactNode) => {
    const part = PARTS.find((candidate) => candidate.id === id)!;
    return (
      <SectionAccordion
        id={id}
        title={part.label()}
        count={counts[id]}
        open={isOpen(id)}
        onOpenChange={(value) => setOpen(id, value)}
      >
        {children}
      </SectionAccordion>
    );
  };
  return (
    <>
      {block("agenda", <AgendaView trip={trip} onOpenRecord={onOpenAgendaRecord} />)}
      {block(
        "areas",
        <AreaManager
          trip={trip}
          focusId={focusFor(recordFocus, "area")}
          locationFocusId={focusFor(recordFocus, "location")}
        />,
      )}
      {block(
        "visits",
        <VisitManager
          trip={trip}
          onShowOnMap={onShowOnMap}
          focusId={focusFor(recordFocus, "visit")}
        />,
      )}
      {block(
        "stays",
        <StayManager trip={trip} areas={areas} focusId={focusFor(recordFocus, "stay")} />,
      )}
      {block("routes", <RouteManager trip={trip} focusId={focusFor(recordFocus, "route")} />)}
    </>
  );
}
