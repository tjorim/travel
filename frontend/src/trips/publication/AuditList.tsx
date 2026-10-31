import { useQuery } from "@tanstack/react-query";
import { formatDate, formatNumber, useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { ownerRequest } from "../../query/api";
import { ownerKeys } from "../../query/keys";
import { tripPath, useOwner } from "../../query/owner-queries";
import type { AuditEvent } from "../../tracker-model";
import { isVisitorField, visitorFieldLabel } from "../locations/model";

function eventMessage(event: AuditEvent) {
  const messages = {
    "public_projection.publish": m.audit_publish,
    "public_projection.unpublish": m.audit_unpublish,
    "public_projection.scope_change": m.audit_public_scope,
    "share_link.create": m.audit_create,
    "share_link.activate": m.audit_activate,
    "share_link.revoke": m.audit_revoke,
    "share_link.rotate": m.audit_rotate,
    "share_link.expire": m.audit_expire,
    "share_link.scope_change": m.audit_link_scope,
    "location.merge": m.audit_location_merge,
    "area.merge": m.audit_area_merge,
  };
  if (event.kind === "location.update")
    return m.audit_location_update({
      fields: changedFields(event).filter(isVisitorField).map(visitorFieldLabel).join(", "),
    });
  if (event.kind !== "record.visibility_change")
    return messages[event.kind]?.() ?? m.audit_unknown();
  const { record_kind, from, to } = event.details;
  const records = {
    area: m.audit_area,
    location: m.audit_location,
    visit: m.audit_visit,
    route: m.audit_route,
    stay: m.audit_stay,
    travel_update: m.audit_travel_update,
    media_derivative: m.audit_media_derivative,
  };
  const visibility = {
    private: m.audit_private,
    everyone: m.audit_everyone,
    custom: m.audit_custom,
  };
  if (!from || !to || !visibility[from] || !visibility[to]) return m.audit_unknown();
  return m.audit_visibility({
    record: ((record_kind && records[record_kind]) || m.audit_record)(),
    before: visibility[from](),
    after: visibility[to](),
  });
}

const changedFields = (event: AuditEvent) =>
  (event.details.changes ?? []).map((change) => change.field);

function audienceCounts(audiences: string[]) {
  return {
    publicCount: formatNumber(audiences.filter((audience) => audience === "public").length),
    linkCount: formatNumber(audiences.filter((audience) => audience.startsWith("link:")).length),
  };
}

export function AuditList({ tripId }: { tripId: string }) {
  useLocale();
  const owner = useOwner();
  const query = useQuery({
    queryKey: [...ownerKeys.trip(owner?.subject ?? "", tripId), "audit-events"],
    enabled: owner !== null,
    queryFn: ({ signal }) =>
      ownerRequest<AuditEvent[]>(owner!.session, tripPath(tripId, "audit-events"), m.audit_error, {
        signal,
      }),
  });
  return (
    <section className="grid gap-3" aria-labelledby="sharing-audit-heading">
      <h3 id="sharing-audit-heading">{m.audit_heading()}</h3>
      {query.isPending ? (
        <p role="status">{m.audit_loading()}</p>
      ) : query.isError ? (
        <p role="alert">{m.audit_error()}</p>
      ) : !query.data.length ? (
        <p>{m.audit_empty()}</p>
      ) : (
        <ol className="grid gap-3">
          {query.data.map((event) => (
            <li key={event.id} className="grid gap-1">
              <time dateTime={event.occurred_at}>
                {formatDate(new Date(event.occurred_at), {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              <p>{eventMessage(event)}</p>
              {event.kind === "location.update" && (
                <p>
                  {m.audit_location_update_audiences(
                    audienceCounts([
                      ...new Set(
                        (event.details.changes ?? []).flatMap((change) => change.audiences),
                      ),
                    ]),
                  )}
                </p>
              )}
              {event.kind === "record.visibility_change" && (
                <>
                  {!!event.details.newly_reached?.length && (
                    <p>{m.audit_reached(audienceCounts(event.details.newly_reached))}</p>
                  )}
                  {!!event.details.no_longer_reached?.length && (
                    <p>{m.audit_withdrawn(audienceCounts(event.details.no_longer_reached))}</p>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
