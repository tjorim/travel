import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { Markdown } from "../Markdown";
import { TripMap, type MapLine, type MapPoint } from "../TripMap";
import { formatDay, type Visit } from "../tracker-model";
import { VISIT_KIND_LABELS, VISIT_STATUS_LABELS } from "../trips/VisitManager";
import type { OfflineResourceKind } from "./offline-store";

/** Legacy emergency snapshots stored this schema-owned enum as a Dutch display label. */
const emergencyKinds: Record<string, () => string> = {
  contact: m.assets_contact_person,
  Contactpersoon: m.assets_contact_person,
  number: m.assets_phone_number,
  Telefoonnummer: m.assets_phone_number,
  medical_note: m.assets_medical_note,
  "Medische notitie": m.assets_medical_note,
};

export function OfflineSnapshotView({ kind, text }: { kind: OfflineResourceKind; text: string }) {
  useLocale();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return <p role="alert">{m.assets_invalid_snapshot()}</p>;
  }
  if (!value || typeof value !== "object") return <p role="alert">{m.assets_invalid_snapshot()}</p>;
  const data = value as Record<string, unknown>;
  if (kind === "emergency_info" && typeof data.label === "string" && typeof data.value === "string") {
    return (
      <div className="grid gap-3">
        <p>
          {typeof data.kind === "string"
            ? (emergencyKinds[data.kind]?.() ?? m.assets_emergency_information())
            : m.assets_emergency_information()}
        </p>
        <dl>
          <dt className="font-semibold">{m.assets_label()}</dt>
          <dd>{data.label}</dd>
          <dt className="font-semibold">{m.assets_value()}</dt>
          <dd>{data.value}</dd>
        </dl>
        <Markdown text={typeof data.notes === "string" ? data.notes : null} />
      </div>
    );
  }
  if (kind === "route_data" && Array.isArray(data.points) && Array.isArray(data.lines)) {
    // Older snapshots contain derived display labels and serialized action labels. Rebuild chrome
    // from canonical kinds; authored point/route labels stay unchanged and no edit actions reopen.
    const points = (data.points as MapPoint[]).map((point) => ({
      ...point,
      detail: point.kind === "derived" ? m.owner_derived_from_private_locations() : point.detail,
      links: [],
    }));
    const lines = (data.lines as MapLine[]).map((line) => ({ ...line, links: [] }));
    return <TripMap points={points} lines={lines} />;
  }
  if (kind === "visit" && data.area && typeof data.area === "object") {
    const visit = data as unknown as Visit;
    return (
      <div className="grid gap-3">
        <p>
          {visit.kind && VISIT_KIND_LABELS[visit.kind]} · {VISIT_STATUS_LABELS[visit.status]}
        </p>
        {visit.starts_on && (
          <p>
            {formatDay(visit.starts_on)}
            {visit.ends_on ? ` – ${formatDay(visit.ends_on)}` : ""}
          </p>
        )}
        <Markdown text={visit.summary} />
        <Markdown text={visit.notes} />
      </div>
    );
  }
  return <p role="alert">{m.assets_invalid_snapshot()}</p>;
}
