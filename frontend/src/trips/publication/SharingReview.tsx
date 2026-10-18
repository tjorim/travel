import { Collapsible } from "@base-ui/react/collapsible";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type { TripOverview, OverviewAudience, OverviewWarning } from "../../tracker-model";
import { VisibilityControl } from "../visibility";
import { DATE_PRECISIONS, GROUP_TITLES, groupBy, type CatalogItem } from "./catalog";

const MAP_KINDS = {
  visits: m.assets_count_visits,
  stays: m.assets_count_stays,
  updates: m.assets_count_updates,
};

/** Describe canonical warning codes; server prose is diagnostic only. */
function reviewText(warning: OverviewWarning, audiences: OverviewAudience[]): string {
  const name =
    warning.audience_id === null
      ? m.assets_the_page_for_everyone()
      : m.assets_link({ p0: warning.audience ?? "" });
  switch (warning.code) {
    case "location_repeats_area":
      return m.owner_location_repeats_area({ name: warning.text ?? "" });
    case "visit_restates_route":
      return m.owner_visit_restates_route({ name: warning.text ?? "" });
    case "live_audience_receives_nothing":
      return m.assets_is_active_but_receives_no_items_set_items_to_everyone_or_select_them_for({
        p0: name,
      });
    case "trip_dates_shared":
      return m.assets_shows_the_travel_dates({
        p0: name,
        p1:
          DATE_PRECISIONS[warning.text as keyof typeof DATE_PRECISIONS]?.toLowerCase() ??
          warning.text ??
          "",
      });
    case "planning_marker_visible":
      return m.assets_shows_with_a_planning_word_in_its_name_rename_it_the_status_belongs_to_t({
        p0: name,
        p1: warning.text ?? "",
      });
    case "map_point_withheld": {
      const audience = audiences.find((item) => item.id === warning.audience_id);
      if (!audience) return m.assets_unknown_warning();
      const counts = (Object.keys(MAP_KINDS) as (keyof typeof MAP_KINDS)[])
        .filter((kind) => audience.without_map_point[kind] > 0)
        .map((kind) => MAP_KINDS[kind]({ count: audience.without_map_point[kind] }));
      return m.assets_receives_without_a_map_point_because_their_area_is_not_shared_or_has_no_({
        p0: name,
        p1: counts.join(", "),
      });
    }
    case "undated_visit_duplicates_dated":
      return m.assets_visit_has_no_date_but_its_area_already_has_a_dated_visit_give_it_a_date_({
        p0: warning.text ?? "",
      });
    default:
      return m.assets_unknown_warning();
  }
}

/** What to check before sharing, from the same projection visitors receive. */
export function SharingReview({ overview }: { overview: TripOverview | undefined }) {
  useLocale();
  if (!overview) return null;
  const warnings = [...overview.warnings].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1,
  );
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.assets_sharing_check()}</h3>
          <p>
            {m.assets_what_each_active_or_draft_audience_currently_receives_and_what_you_shoul()}
          </p>
        </div>
      </div>
      <ul
        className="m-0 grid gap-1.5 pl-5 leading-normal text-travel-positive"
        aria-label={m.assets_sharing_check()}
      >
        {overview.audiences.map((audience) => {
          const delivered = audience.delivered;
          return (
            <li key={audience.id ?? "public"}>
              <strong>
                {audience.kind === "public" ? m.assets_for_everyone() : audience.label}
              </strong>{" "}
              ·{" "}
              {m.assets_audience_summary({
                state: audience.live
                  ? m.assets_active()
                  : audience.kind === "public"
                    ? m.assets_not_shared()
                    : m.assets_draft(),
                counts: [
                  m.assets_count_visits({ count: delivered.visits }),
                  m.assets_count_stays({ count: delivered.stays }),
                  m.assets_count_routes({ count: delivered.routes }),
                  m.assets_count_updates({ count: delivered.updates }),
                  m.assets_count_places({ count: delivered.places }),
                  m.assets_count_media({ count: delivered.media }),
                ].join(", "),
              })}
            </li>
          );
        })}
        {warnings.map((warning, index) => (
          <li
            key={`${warning.code}-${warning.audience_id ?? warning.id ?? ""}-${index}`}
            className={warning.severity === "warning" ? "text-travel-review-warning" : undefined}
          >
            {reviewText(warning, overview.audiences)}
          </li>
        ))}
        {warnings.length === 0 && <li>{m.assets_nothing_to_review()}</li>}
      </ul>
    </div>
  );
}

export function VisibilityOverview({
  tripId,
  catalog,
}: {
  tripId: string;
  catalog: CatalogItem[];
}) {
  useLocale();
  const groups = groupBy(catalog);
  if (!groups.size)
    return (
      <p className="help">
        {m.assets_there_are_no_items_to_share_yet_create_a_travel_update_area_or_visit_for()}
      </p>
    );
  return (
    <div className="grid gap-2">
      {[...groups].map(([kind, items]) => (
        <Collapsible.Root className="scope-group" data-disclosure="" key={kind}>
          <Collapsible.Trigger>
            <strong>{GROUP_TITLES[kind]}</strong>
            <span>
              {m.assets_of_is_set_to_everyone_or_choose_in_sharing_line({
                p0: items.filter((item) => item.visibility !== "private" || item.followsUpdate)
                  .length,
                p1: items.length,
              })}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Panel keepMounted className="grid gap-2 px-3.25 pt-0 pb-3.25">
            {items.map((item) => (
              <article className="scope-item" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </div>
                <VisibilityControl
                  tripId={tripId}
                  kind={item.kind}
                  id={item.id}
                  value={item.visibility}
                  name={item.label}
                  followsUpdate={item.followsUpdate}
                />
              </article>
            ))}
          </Collapsible.Panel>
        </Collapsible.Root>
      ))}
    </div>
  );
}
