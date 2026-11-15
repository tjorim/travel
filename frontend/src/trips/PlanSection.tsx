import { useEffect } from "react";

import { useLocale } from "../locale";
import { useTripResource } from "../query/owner-queries";
import { AgendaManager } from "./AgendaManager";
import { AreaManager } from "./AreaManager";
import { focusFor } from "./record-focus";
import { PlanEditors, usePlanHost } from "./plan-host";
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
  onShowOnMap,
  createRequest,
  onCreateRecord,
  onCreateHandled,
}: SectionProps) {
  useLocale();
  const { isOpen, setOpen } = useOpenSections(PARTS, recordFocus);
  // The agenda hosts the one dialog per kind of record; the type blocks below only ask it to open.
  const host = usePlanHost(recordFocus, createRequest, onCreateHandled, () =>
    setOpen("agenda", true),
  );
  // A new record from elsewhere ends up in the agenda: keep that block open so focus can land on it.
  const createToken = createRequest?.token;
  useEffect(() => {
    if (createToken) setOpen("agenda", true);
  }, [createToken]);
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
      {block(
        "agenda",
        <>
          <AgendaManager
            trip={trip}
            host={host}
            onShowOnMap={onShowOnMap}
            onCreateRecord={onCreateRecord}
          />
          <PlanEditors trip={trip} host={host} />
        </>,
      )}
      {block(
        "areas",
        <AreaManager
          trip={trip}
          focusId={focusFor(recordFocus, "area")}
          locationFocusId={focusFor(recordFocus, "location")}
        />,
      )}
      {block("visits", <VisitManager trip={trip} onShowOnMap={onShowOnMap} host={host} />)}
      {block("stays", <StayManager trip={trip} areas={areas} host={host} />)}
      {block("routes", <RouteManager trip={trip} host={host} />)}
    </>
  );
}
