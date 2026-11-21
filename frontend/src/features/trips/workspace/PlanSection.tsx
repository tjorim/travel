import { useEffect, useState } from "react";

import { useLocale } from "@/i18n/locale";
import type { AgendaRecordKind } from "../agenda/agenda-items";
import { AgendaManager } from "../agenda/AgendaManager";
import { AreaManager } from "../areas/AreaManager";
import { focusFor } from "../records/record-focus";
import { PlanEditors, usePlanHost } from "./plan-host";
import { SectionAccordion } from "./SectionAccordion";
import { useOpenSections } from "./use-open-sections";
import { partsOf, type SectionProps } from "./workspace-sections";

const PARTS = partsOf("plan");

type KindRequest = { kinds: readonly AgendaRecordKind[]; token: number };

/**
 * The workspace's planning tab: its editors load together, on first opening it. The agenda manages visits, stays and
 * routes (#374); areas and locations, which have no day, are the other block.
 */
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
  // An address of a retired block (`#stays`) opens the agenda with that kind as its filter.
  const [kindRequest, setKindRequest] = useState<KindRequest | null>(null);
  const { isOpen, setOpen } = useOpenSections(PARTS, recordFocus, (alias) => {
    if (alias.kinds)
      setKindRequest((current) => ({ kinds: alias.kinds!, token: (current?.token ?? 0) + 1 }));
  });
  // The agenda hosts the one dialog per kind of record and the status line they report to.
  const host = usePlanHost(recordFocus, createRequest, onCreateHandled, () =>
    setOpen("agenda", true),
  );
  // A new record from elsewhere ends up in the agenda: keep that block open so focus can land on it.
  const createToken = createRequest?.token;
  useEffect(() => {
    if (createToken) setOpen("agenda", true);
  }, [createToken]);
  const block = (id: string, children: React.ReactNode, count?: number) => {
    const part = PARTS.find((candidate) => candidate.id === id)!;
    return (
      <SectionAccordion
        id={id}
        title={part.label()}
        count={count}
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
            kindRequest={kindRequest}
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
        areas.length,
      )}
    </>
  );
}
