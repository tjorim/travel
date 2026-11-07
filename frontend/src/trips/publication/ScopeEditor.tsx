import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";
import { useState } from "react";

import { AdvancedSection } from "../../forms/AdvancedSection";
import { SearchSelect } from "../../forms/fields";
import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { errorMessage } from "../../query/api";
import { FeedbackError } from "../../query/feedback";
import type { DatePrecision, ShareScope, ShareScopeKind } from "../../tracker-model";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/ui/field";
import { TravelCheckbox } from "@/ui/TravelCheckbox";
import { useSetVisibility } from "../visibility";
import { DATE_PRECISIONS, GROUP_TITLES, groupBy, updateItem, type CatalogItem } from "./catalog";
import { ExclusionList } from "./ExclusionList";
import { PresetSection, type ScopePreset } from "./PresetSection";

function ScopeGroup({
  kind,
  items,
  scope,
  setScope,
  tripId,
  onError,
}: {
  kind: ShareScopeKind;
  items: CatalogItem[];
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  tripId: string;
  onError: (error: unknown) => void;
}) {
  useLocale();
  const setVisibility = useSetVisibility(tripId);
  const [busy, setBusy] = useState(false);
  const chosen = (item: CatalogItem) =>
    scope.items.some((value) => value.kind === item.kind && value.id === item.id);
  const count = items.filter(chosen).length;

  /** Promotes each record on its own, so one that cannot be shared yet does not hold back the rest. */
  async function promote(toPromote: CatalogItem[]): Promise<CatalogItem[]> {
    if (!toPromote.length) return [];
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        toPromote.map((item) =>
          setVisibility.mutateAsync({ kind: item.kind, id: item.id, visibility: "custom" }),
        ),
      );
      const failed = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ item: toPromote[index]!, reason: result.reason as unknown }]
          : [],
      );
      if (failed.length)
        onError(
          new FeedbackError(() =>
            m.api_selection_failed({
              count: failed.length,
              labels: failed.map(({ item }) => `“${item.label}”`).join(", "),
              reason: errorMessage(failed[0]!.reason, m.api_operation_failed()),
            }),
          ),
        );
      return toPromote.filter((_, index) => results[index]!.status === "fulfilled");
    } finally {
      setBusy(false);
    }
  }

  async function include(item: CatalogItem, checked: boolean) {
    if (checked && item.visibility === "private" && !(await promote([item])).length) return;
    setScope(updateItem(scope, item, checked));
  }

  async function chooseAll() {
    const promoted = await promote(
      items.filter((item) => item.visibility === "private" && !chosen(item)),
    );
    setScope(
      items
        .filter((item) => item.visibility !== "private" || chosen(item) || promoted.includes(item))
        .reduce((current, item) => updateItem(current, item, true), scope),
    );
  }

  return (
    <Collapsible.Root className="scope-group" data-disclosure="">
      <Collapsible.Trigger className="max-sm:flex-wrap max-sm:justify-start max-sm:[&>strong]:basis-3/4 max-sm:[&>span]:basis-full max-sm:[&>span]:pl-6">
        <strong>{GROUP_TITLES[kind]}</strong>
        <span>{m.assets_of_selected_line({ p0: count, p1: items.length })}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className="grid gap-2.5 px-3.25 pt-0 pb-3.25">
        <div className="button-row">
          <Button
            className="secondary compact"
            type="button"
            disabled={busy || count === items.length}
            onClick={() => void chooseAll()}
          >
            {m.assets_select_all()}
          </Button>
          <Button
            className="secondary compact"
            type="button"
            disabled={busy || count === 0}
            onClick={() =>
              setScope(items.reduce((current, item) => updateItem(current, item, false), scope))
            }
          >
            {m.assets_select_none()}
          </Button>
        </div>
        <div className="grid gap-2">
          {items.map((item) => (
            <article
              className="scope-item"
              data-included={chosen(item) ? "" : undefined}
              key={`${item.kind}-${item.id}`}
            >
              <Field className="contents">
                <FieldLabel className="scope-choice">
                  <TravelCheckbox
                    checked={chosen(item)}
                    disabled={busy}
                    onCheckedChange={(checked) => void include(item, checked)}
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                    {item.visibility === "private" && (
                      <em className="text-xs font-medium not-italic text-travel-muted">
                        {" "}
                        {m.assets_currently_private_selecting_includes_this_for_this_audience()}
                      </em>
                    )}
                  </span>
                </FieldLabel>
              </Field>
            </article>
          ))}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

/** What every audience gets without being chosen: the same setting as on each record, kept out of the lists below. */
function VisibilityNote({ catalog }: { catalog: CatalogItem[] }) {
  useLocale();
  const own = catalog.filter((item) => !item.followsUpdate);
  if (!own.length) return null;
  const everyone = own.filter((item) => item.visibility === "everyone").length;
  const privateCount = own.filter((item) => item.visibility === "private").length;
  return (
    <p className="help">
      {m.assets_for_everyone_always_appears_here_you_can_select_private_items_bel_line({
        p0: everyone,
        p1: privateCount,
      })}
    </p>
  );
}

/** The same note for a hidden link or collection member, which can leave records set to Everyone out. */
function AudienceVisibilityNote({ catalog }: { catalog: CatalogItem[] }) {
  useLocale();
  const own = catalog.filter((item) => !item.followsUpdate);
  if (!own.length) return null;
  return (
    <p className="help">
      {m.exclusions_visibility_note({
        p0: own.filter((item) => item.visibility === "everyone").length,
        p1: own.filter((item) => item.visibility === "private").length,
      })}
    </p>
  );
}

/**
 * How precisely this audience may read dates. It caps every record's own setting (the coarser wins), so
 * "days" lets records that follow the audience show days, and a record's own month still shows months.
 */
function AudiencePrecision({
  scope,
  setScope,
}: {
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
}) {
  useLocale();
  const value = scope.defaults?.date_precision ?? "";
  return (
    <div className="grid gap-1.5">
      <Field className="max-w-sm">
        <FieldLabel>{m.precision_audience_label()}</FieldLabel>
        <SearchSelect
          ariaLabel={m.precision_audience_label()}
          value={value}
          onChange={(next) =>
            setScope({
              ...scope,
              defaults: { date_precision: (next || null) as DatePrecision | null },
            })
          }
        >
          <option value="">{m.precision_audience_unset()}</option>
          <option value="day">{m.precision_audience_day()}</option>
          <option value="month">{m.precision_audience_month()}</option>
          <option value="year">{m.precision_audience_year()}</option>
        </SearchSelect>
      </Field>
      <small>{m.precision_audience_help()}</small>
      {!value && <small>{m.precision_audience_unset_help()}</small>}
    </div>
  );
}

/**
 * The trip's own start and end dates: whether visitors read them at all, and how finely. The audience's date limit
 * above caps them as well (the coarser setting wins), so this stays an Advanced choice with a plain default: hidden.
 */
function TripDates({
  scope,
  setScope,
  hasDates,
}: {
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  hasDates: boolean;
}) {
  useLocale();
  return (
    <div className="grid gap-1.5">
      <Field className="max-w-sm">
        <FieldLabel>{m.assets_how_precise_can_the_travel_dates_be()}</FieldLabel>
        <SearchSelect
          ariaLabel={m.assets_how_precise_can_the_travel_dates_be()}
          value={scope.trip.dates ?? ""}
          onChange={(value) =>
            setScope({
              ...scope,
              trip: { ...scope.trip, dates: (value || null) as ShareScope["trip"]["dates"] },
            })
          }
        >
          <option value="">{m.assets_hide()}</option>
          {Object.entries(DATE_PRECISIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SearchSelect>
      </Field>
      <small>{m.sharing_advanced_trip_dates_help()}</small>
      {scope.trip.dates === "day" && <small>{m.assets_visitors_see_the_start_and_end_day()}</small>}
      {scope.trip.dates === "month" && (
        <small>{m.assets_visitors_see_only_the_start_and_end_month()}</small>
      )}
      {scope.trip.dates === "year" && <small>{m.assets_visitors_see_only_the_travel_year()}</small>}
      {scope.trip.dates && !hasDates && (
        <small>{m.assets_this_trip_has_no_travel_dates_yet()}</small>
      )}
    </div>
  );
}

export function ScopeEditor({
  scope,
  setScope,
  name,
  catalog,
  hasDates,
  tripId,
  onError,
  disabled = false,
  allowExclusions = false,
  preset,
}: {
  scope: ShareScope;
  setScope: (scope: ShareScope) => void;
  name: string;
  catalog: CatalogItem[];
  hasDates: boolean;
  tripId: string;
  onError: (error: unknown) => void;
  disabled?: boolean;
  /** A hidden link or collection member starts from the public baseline and may leave records out of it. The public page may not. */
  allowExclusions?: boolean;
  /** The preset picker of a saved audience (or of a link about to be created). Absent where a preset makes no sense, such as the server's copy in a conflict. */
  preset?: ScopePreset;
}) {
  useLocale();
  const groups = groupBy(catalog.filter((item) => item.visibility !== "everyone"));
  // Advanced holds what most audiences never touch. It opens by itself when the audience already uses it, so a
  // choice stored in it is never hidden from the owner.
  const advancedInUse = scope.trip.dates !== null || scope.items.length > 0;
  return (
    <FieldSet
      className="m-0 grid min-w-0 gap-3 rounded-xl border border-travel-divider p-3.75 [&>legend]:px-1.5 [&>legend]:font-extrabold [&>p]:m-0 [&>p]:text-sm"
      disabled={disabled}
    >
      <FieldLegend>{name}</FieldLegend>
      <p>{m.assets_choose_what_visitors_can_see_everything_you_do_not_select_stays_private()}</p>
      {preset && (
        <PresetSection
          // Another audience starts with nothing chosen.
          key={JSON.stringify(preset.target)}
          preset={preset}
          scope={scope}
          setScope={setScope}
          catalog={catalog}
          tripId={tripId}
          allowExclusions={allowExclusions}
          disabled={disabled}
          onError={onError}
        />
      )}
      <div className="flex flex-wrap gap-x-3.5 gap-y-2">
        <Field className="contents">
          <FieldLabel className="scope-choice">
            <TravelCheckbox
              checked={scope.trip.title}
              onCheckedChange={(checked) =>
                setScope({ ...scope, trip: { ...scope.trip, title: checked } })
              }
            />
            {m.assets_trip_title()}
          </FieldLabel>
        </Field>
        <Field className="contents">
          <FieldLabel className="scope-choice">
            <TravelCheckbox
              checked={scope.trip.summary}
              onCheckedChange={(checked) =>
                setScope({ ...scope, trip: { ...scope.trip, summary: checked } })
              }
            />
            {m.owner_summary()}
          </FieldLabel>
        </Field>
      </div>
      <AudiencePrecision scope={scope} setScope={setScope} />
      {allowExclusions ? (
        <>
          <AudienceVisibilityNote catalog={catalog} />
          <ExclusionList
            scope={scope}
            setScope={setScope}
            catalog={catalog}
            tripId={tripId}
            disabled={disabled}
          />
        </>
      ) : (
        <VisibilityNote catalog={catalog} />
      )}
      <AdvancedSection summary={m.sharing_advanced_scope_summary()} inUse={advancedInUse}>
        <TripDates scope={scope} setScope={setScope} hasDates={hasDates} />
        <div className="grid gap-2">
          <div className="grid gap-1">
            <h4 className="m-0 text-base">{m.sharing_advanced_custom_heading()}</h4>
            <p className="help m-0">{m.sharing_advanced_custom_help()}</p>
          </div>
          {[...groups].map(([kind, items]) => (
            <ScopeGroup
              key={kind}
              kind={kind}
              items={items}
              scope={scope}
              setScope={setScope}
              tripId={tripId}
              onError={onError}
            />
          ))}
          {!groups.size && !allowExclusions && (
            <p className="help">
              {m.assets_there_is_nothing_to_select_yet_items_already_set_to_everyone_always_appe()}
            </p>
          )}
        </div>
      </AdvancedSection>
    </FieldSet>
  );
}

/** Every shareable record with the same control as in its own editor; both write one field. */
