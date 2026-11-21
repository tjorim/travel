import type { ComponentProps } from "react";

import { useLocale } from "@/i18n/locale";
import type { Trip } from "../api-types";
import { AlternativesArea } from "./alternatives/AlternativesArea";
import { AgendaView, type AgendaRowActions } from "./AgendaView";
import type { CreateKind, CreatePrefill } from "./create-request";
import type { PlanHost } from "./plan-host";
import { useStayNights } from "./stays/use-stay-nights";
import { mapPointFor } from "./visits/model";
import { useVisitOffline } from "./visits/use-visit-offline";

/**
 * The agenda as the place where visits, stays and routes are managed: the timeline with each row's menu, the
 * alternatives of every kind above it, and the one status line the three record dialogs report to.
 */
export function AgendaManager({
  trip,
  host,
  onShowOnMap,
  onCreateRecord,
  kindRequest,
}: {
  trip: Trip;
  host: PlanHost;
  kindRequest?: ComponentProps<typeof AgendaView>["kindRequest"];
  onShowOnMap?: (pointId: string) => void;
  onCreateRecord?: (
    kind: CreateKind,
    prefill: CreatePrefill,
    returnTo?: HTMLElement | null,
  ) => void;
}) {
  useLocale();
  const offline = useVisitOffline(trip.id, host.report);
  const nights = useStayNights(trip.id, host.report);
  const actions: AgendaRowActions = {
    onAct: host.open,
    onShowOnMap: onShowOnMap && ((visit) => onShowOnMap(mapPointFor(visit))),
    isPinned: offline.isPinned,
    onToggleOffline: offline.toggle,
    onAdjustNights: nights.adjust,
    adjustingNights: nights.saving,
  };
  return (
    <AgendaView
      trip={trip}
      onOpenRecord={(kind, id) => host.open(kind, id)}
      onCreateRecord={onCreateRecord}
      actions={actions}
      notice={host.message}
      kindRequest={kindRequest}
      alternatives={
        <AlternativesArea tripId={trip.id} onOpen={(kind, id) => host.open(kind, id)} />
      }
    />
  );
}
