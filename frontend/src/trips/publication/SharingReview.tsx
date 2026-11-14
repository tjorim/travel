import { LiveLocation } from "../LiveLocation";
import { VisitorNumbers } from "../../VisitorNumbers";
import { Collapsible } from "@/ui/collapsible";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import type {
  DatePrecision,
  FutureDisclosure,
  OverviewAudience,
  OverviewRecordPrecision,
  OverviewWarning,
  TripOverview,
} from "../../api-types";
import { VisibilityControl } from "../visibility";
import { presetLabelText } from "./PresetSection";
import {
  DATE_PRECISIONS,
  GROUP_TITLES,
  groupBy,
  kindCountsText,
  type CatalogItem,
} from "./catalog";

const MAP_KINDS = {
  visits: m.visits_count,
  stays: m.stays_count,
  updates: m.updates_count,
};

const PRECISION_NAMES: Record<DatePrecision, () => string> = {
  day: () => m.precision_audience_day().toLowerCase(),
  month: () => m.precision_audience_month().toLowerCase(),
  year: () => m.precision_audience_year().toLowerCase(),
};
const PRECISION_PARTS: Record<DatePrecision, (inputs: { count: number }) => string> = {
  day: m.precision_check_by_day,
  month: m.precision_check_by_month,
  year: m.precision_check_by_year,
};

/** How an audience reads dates: its own limit, then how many visits and stays read at each precision. */
export function precisionLines(audience: OverviewAudience): string[] {
  const lines = [
    audience.date_precision
      ? m.precision_check_audience({ precision: PRECISION_NAMES[audience.date_precision]() })
      : m.precision_check_audience_unset(),
  ];
  const kinds = [
    ["visits", m.common_visits] as const,
    ["stays", m.common_stays] as const,
    ["routes", m.common_routes] as const,
  ];
  for (const [kind, label] of kinds) {
    const summary: OverviewRecordPrecision | undefined = audience.record_precision?.[kind];
    const parts = (["day", "month", "year"] as const)
      .filter((precision) => (summary?.by_precision[precision] ?? 0) > 0)
      .map((precision) => PRECISION_PARTS[precision]({ count: summary!.by_precision[precision]! }));
    if (!summary || !parts.length) continue;
    const breakdown = [
      parts.join(", "),
      summary.limited_by_record
        ? m.precision_check_limited({ count: summary.limited_by_record })
        : "",
      summary.default_applied ? m.precision_check_default({ count: summary.default_applied }) : "",
    ]
      .filter(Boolean)
      .join("; ");
    lines.push(m.precision_check_kind({ kind: label(), breakdown }));
  }
  return lines;
}

/** The preset last applied to an audience and how many records differ from it today, if one was applied. */
export function presetLines(audience: OverviewAudience): string[] {
  return audience.preset
    ? [
        m.preset_check_line({
          label: presetLabelText(audience.preset, audience.preset_exceptions ?? 0),
        }),
      ]
    : [];
}

/** What a hidden link leaves out of the public baseline: how many records, and what that also hides. */
export function exclusionLines(audience: OverviewAudience): string[] {
  if (!audience.excluded) return [];
  const also = kindCountsText(audience.excluded_also_hides);
  return [
    m.exclusions_check_excluded({ count: audience.excluded }) +
      (also ? `, ${m.exclusions_summary_also({ counts: also })}` : ""),
  ];
}

/**
 * What an audience reads before the trip starts, from the server's counts: exact transport times and dates shown by
 * day. Shared by the Sharing check and the preview, so both say the same thing about the same counts.
 */
export function futureWarningText(
  code: "future_transport_times" | "future_day_dates",
  name: string,
  count: number,
): string {
  return code === "future_transport_times"
    ? m.publication_future_transport_times({
        audience: name,
        count: m.publication_count_transport_legs({ count }),
      })
    : m.publication_future_day_dates({
        audience: name,
        count: m.publication_count_day_dated_records({ count }),
      });
}

/** The lines a disclosure count gives for one audience, empty when it shows nothing of the future. */
export function futureDisclosureLines(disclosure: FutureDisclosure, name: string): string[] {
  return [
    ...(disclosure.transport
      ? [futureWarningText("future_transport_times", name, disclosure.transport)]
      : []),
    ...(disclosure.day_dates
      ? [futureWarningText("future_day_dates", name, disclosure.day_dates)]
      : []),
  ];
}

/** Describe canonical warning codes; server prose is diagnostic only. */
function reviewText(warning: OverviewWarning, audiences: OverviewAudience[]): string {
  const name =
    warning.audience_id === null
      ? m.publication_the_page_for_everyone()
      : m.publication_link({ name: warning.audience ?? "" });
  switch (warning.code) {
    case "location_repeats_area":
      return m.publication_location_repeats_area({ name: warning.text ?? "" });
    case "visit_restates_route":
      return m.publication_visit_restates_route({ name: warning.text ?? "" });
    case "live_audience_receives_nothing":
      return m.publication_audience_empty_warning({
        audience: name,
      });
    case "trip_dates_shared":
      return m.publication_shows_the_travel_dates({
        audience: name,
        precision:
          DATE_PRECISIONS[warning.text as keyof typeof DATE_PRECISIONS]?.toLowerCase() ??
          warning.text ??
          "",
      });
    case "planning_marker_visible":
      return m.publication_planning_word_warning({
        audience: name,
        text: warning.text ?? "",
      });
    case "map_point_withheld": {
      const audience = audiences.find((item) => item.id === warning.audience_id);
      if (!audience) return m.publication_unknown_warning();
      const counts = (Object.keys(MAP_KINDS) as (keyof typeof MAP_KINDS)[])
        .filter((kind) => audience.without_map_point[kind] > 0)
        .map((kind) => MAP_KINDS[kind]({ count: audience.without_map_point[kind] }));
      return m.publication_missing_map_point_warning({
        audience: name,
        items: counts.join(", "),
      });
    }
    case "cover_not_received":
      return m.publication_missing_cover_warning({
        audience: name,
      });
    case "future_transport_times":
    case "future_day_dates":
      return futureWarningText(warning.code, name, warning.count ?? 0);
    case "route_dates_follow_audience":
      return (
        warning.text === "year"
          ? m.publication_route_dates_follow_year
          : m.publication_route_dates_follow_month
      )({
        audience: name,
        count: m.routes_count({ count: warning.count ?? 0 }),
      });
    case "undated_visit_duplicates_dated":
      return m.publication_undated_visit_warning({
        title: warning.text ?? "",
      });
    default:
      return m.publication_unknown_warning();
  }
}

/** What to check before sharing, from the same projection visitors receive. */
export function SharingReview({
  overview,
  tripId,
}: {
  overview: TripOverview | undefined;
  tripId?: string;
}) {
  return (
    <>
      {tripId && <LiveLocation tripId={tripId} />}
      <SharingReviewContent overview={overview} />
    </>
  );
}

function SharingReviewContent({ overview }: { overview: TripOverview | undefined }) {
  useLocale();
  if (!overview) return null;
  const warnings = [...overview.warnings].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1,
  );
  return (
    <div className="manager-subsection">
      <div className="capture-heading">
        <div>
          <h3>{m.sharing_check()}</h3>
          <p>{m.publication_check_intro()}</p>
        </div>
      </div>
      <ul
        className="m-0 grid gap-1.5 pl-5 leading-normal text-travel-positive"
        aria-label={m.sharing_check()}
      >
        {overview.audiences.map((audience) => {
          const delivered = audience.delivered;
          return (
            <li key={audience.id ?? "public"}>
              <strong>
                {audience.kind === "public" ? m.publication_for_everyone() : audience.label}
              </strong>{" "}
              ·{" "}
              {m.publication_audience_summary({
                state: audience.live
                  ? m.publication_active()
                  : audience.kind === "public"
                    ? m.publication_not_shared()
                    : m.publication_draft(),
                counts: [
                  m.visits_count({ count: delivered.visits }),
                  m.stays_count({ count: delivered.stays }),
                  m.routes_count({ count: delivered.routes }),
                  m.updates_count({ count: delivered.updates }),
                  m.publication_count_places({ count: delivered.places }),
                  m.publication_count_media({ count: delivered.media }),
                ].join(", "),
              })}
              <VisitorNumbers numbers={audience.numbers} />
              <ul className="m-0 mt-1 grid list-disc gap-0.5 pl-5 text-sm">
                {[
                  ...presetLines(audience),
                  ...exclusionLines(audience),
                  ...precisionLines(audience),
                ].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
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
        {warnings.length === 0 && <li>{m.publication_nothing_to_review()}</li>}
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
  if (!groups.size) return <p className="help">{m.publication_check_empty()}</p>;
  return (
    <div className="grid gap-2">
      {[...groups].map(([kind, items]) => (
        <Collapsible.Root className="scope-group" data-disclosure="" key={kind}>
          <Collapsible.Trigger className="max-sm:flex-wrap max-sm:justify-start max-sm:[&>strong]:basis-3/4 max-sm:[&>span]:basis-full max-sm:[&>span]:pl-6">
            <strong>{GROUP_TITLES[kind]}</strong>
            <span>
              {m.publication_shared_count({
                shared: items.filter((item) => item.visibility !== "private" || item.followsUpdate)
                  .length,
                total: items.length,
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
