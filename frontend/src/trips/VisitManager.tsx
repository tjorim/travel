import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { FeedbackError, textNotice, errorNotice, useFeedback } from "../query/feedback";
import { Button } from "@base-ui/react/button";
import { useMemo, useRef } from "react";

import { CheckboxField, RecordForm, SelectField, TextField } from "../forms/fields";
import { DateField, TimeField } from "../forms/DateTimeFields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, useRecordDialog, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { useOfflineCopies } from "../offline/useOfflineCopies";
import { errorMessage } from "../query/api";
import { ownerKeys } from "../query/keys";
import { tripPath, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import {
  addDays,
  formatDayRange,
  locationName,
  stayCoversNight,
  stayLabel,
  visitTitle,
  type Stay,
  type Trip,
  type Visit,
  type VisitKind,
  type VisitStatus,
} from "../tracker-model";
import {
  emptyPlace,
  hasPlace,
  PlacePicker,
  placeFields,
  placeOfVisit,
  samePlace,
  type PlaceValue,
} from "./PlacePicker";
import { VisibilityControl, visibilityLabel } from "./visibility";
import { RestatedRoutesNote, VisitRouteHint } from "./VisitRouteHint";

export const VISIT_KIND_LABELS: Record<VisitKind, string> = {
  get free() {
    return m.owner_leisure();
  },
  get work() {
    return m.owner_work();
  },
};
export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  get idea() {
    return m.owner_idea();
  },
  get planned() {
    return m.owner_planned();
  },
  get confirmed() {
    return m.owner_confirmed();
  },
};
const KIND_LABELS = VISIT_KIND_LABELS;
const STATUS_LABELS = VISIT_STATUS_LABELS;
const PRECISION_LABELS = {
  get day() {
    return m.owner_full_dates();
  },
  get month() {
    return m.owner_months_only();
  },
  get year() {
    return m.owner_year_only();
  },
} as const;

type TripDates = Pick<Trip, "starts_on" | "ends_on">;

/** Every trip night a visit spans: none before departure, none on the final day. */
function visitNights(visit: Pick<Visit, "starts_on" | "ends_on">, trip: TripDates): string[] {
  if (!visit.starts_on) return [];
  const nights: string[] = [];
  for (
    let night = visit.starts_on;
    night <= (visit.ends_on ?? visit.starts_on) && nights.length < 60;
    night = addDays(night, 1)
  ) {
    if ((!trip.starts_on || night >= trip.starts_on) && (!trip.ends_on || night < trip.ends_on)) nights.push(night);
  }
  return nights;
}

/** Which stays the owner sleeps at during a visit, and how many nights lack one. */
export function overnights(
  visit: Pick<Visit, "starts_on" | "ends_on">,
  stays: Stay[],
  trip: TripDates,
): { stays: Stay[]; uncovered: number } {
  const nights = visitNights(visit, trip);
  const covering = stays.filter((stay) => nights.some((night) => stayCoversNight(stay, night)));
  return {
    stays: covering,
    uncovered: nights.filter((night) => !stays.some((stay) => stayCoversNight(stay, night))).length,
  };
}

const clock = (time: string | null): string => (time ? time.slice(0, 5) : "");

/** "21 nov – 22 nov · 18:30–21:00", or "Nog geen dag". */
export function visitWhen(visit: Pick<Visit, "starts_on" | "ends_on" | "start_time" | "end_time">): string {
  if (!visit.starts_on) return m.owner_no_day_yet();
  const times = visit.start_time
    ? ` · ${clock(visit.start_time)}${visit.end_time ? `–${clock(visit.end_time)}` : ""}`
    : "";
  return `${formatDayRange(visit.starts_on, visit.ends_on)}${times}`;
}

/** Where a visit is: its location when it has one, else its area. */
const visitPlace = (visit: Pick<Visit, "area" | "location">): string =>
  visit.location ? `${locationName(visit.location)} · ${visit.area.label}` : visit.area.label;

type Values = {
  place: PlaceValue;
  title: string;
  kind: VisitKind | "";
  status: VisitStatus;
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
  notes: string;
  summary: string;
  shareTime: boolean;
  shareDatePrecision: Visit["share_date_precision"];
};

const blank = (): Values => ({
  place: emptyPlace(),
  title: "",
  kind: "",
  status: "planned",
  startsOn: "",
  endsOn: "",
  startTime: "",
  endTime: "",
  notes: "",
  summary: "",
  shareTime: false,
  shareDatePrecision: "month",
});
const fromVisit = (visit: Visit): Values => ({
  place: placeOfVisit(visit),
  title: visit.title ?? "",
  kind: visit.kind ?? "",
  status: visit.status,
  startsOn: visit.starts_on ?? "",
  endsOn: visit.ends_on ?? "",
  startTime: clock(visit.start_time),
  endTime: clock(visit.end_time),
  notes: visit.notes ?? "",
  summary: visit.summary ?? "",
  shareTime: visit.share_time,
  shareDatePrecision: visit.share_date_precision,
});
const serverFields = {
  title: "title",
  kind: "kind",
  status: "status",
  starts_on: "startsOn",
  ends_on: "endsOn",
  start_time: "startTime",
  end_time: "endTime",
  notes: "notes",
  summary: "summary",
  share_time: "shareTime",
  share_date_precision: "shareDatePrecision",
};

type FormContext = { fieldApi: { form: { getFieldValue: (name: never) => unknown } } };
const lastDay = ({ value, fieldApi }: { value: string } & FormContext) => {
  if (!value) return undefined;
  const first = String(fieldApi.form.getFieldValue("startsOn" as never) ?? "");
  return !first || value < first ? m.owner_the_last_day_must_follow_the_first_day : undefined;
};

export function VisitManager({
  trip,
  onShowOnMap,
  focusId,
}: {
  trip: Trip;
  onShowOnMap?: (pointId: string) => void;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const offline = useOfflineCopies();
  const visitsQuery = useTripResource(trip.id, "visits");
  const staysQuery = useTripResource(trip.id, "stays");
  const visits = useMemo(
    () => (visitsQuery.data ?? []).slice().sort((left, right) => left.position - right.position),
    [visitsQuery.data],
  );
  const stays = staysQuery.data ?? [];
  const dialog = useRecordDialog(visits);
  useDialogFocus(focusId, dialog.inspect);
  const { selected, editing, editingId } = dialog;
  const [message, setMessage] = useFeedback<string>(
    textNotice(() => m.owner_a_visit_is_a_stop_on_your_trip_an_area_or_location_and_when_it_stays_pri()),
  );
  // A place is only rewritten when the editor changed it.
  const baseline = useRef<Values>(blank());
  const path = tripPath(trip.id, "visits");
  // A new location can create a reusable location and its derived area.
  const invalidate = (subject: string) => [
    ownerKeys.tripResource(subject, trip.id, "visits"),
    ownerKeys.tripResource(subject, trip.id, "locations"),
    ownerKeys.tripResource(subject, trip.id, "areas"),
  ];

  const save = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, Visit>({
    fallback: m.owner_the_visit_could_not_be_saved,
    request: ({ id, payload }) => ({ path: id ? `${path}/${id}` : path, method: id ? "PATCH" : "POST", body: payload }),
    invalidate,
  });
  const move = useOwnerMutation<{ visit: Visit; position: number }, Visit>({
    fallback: m.owner_the_visit_could_not_be_moved,
    request: ({ visit, position }) => ({ path: `${path}/${visit.id}`, method: "PATCH", body: { position } }),
    invalidate,
  });
  const remove = useOwnerMutation<Visit>({
    fallback: m.owner_the_visit_could_not_be_deleted,
    request: (visit) => ({ path: `${path}/${visit.id}`, method: "DELETE" }),
    invalidate,
  });

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.owner_the_visit_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      const id = dialog.editingId ?? null;
      if (!hasPlace(values.place))
        throw new FeedbackError(() => m.owner_choose_where_the_visit_is_an_area_or_location());
      if (values.startTime && !values.startsOn)
        throw new FeedbackError(() => m.owner_a_time_belongs_to_a_day_choose_the_first_day_first());
      if (values.endTime && !values.startTime) throw new FeedbackError(() => m.owner_also_enter_a_start_time());
      await save.mutateAsync({
        id,
        payload: {
          title: values.title.trim() || null,
          kind: values.kind || null,
          status: values.status,
          starts_on: values.startsOn || null,
          ends_on: values.endsOn && values.endsOn !== values.startsOn ? values.endsOn : null,
          start_time: values.startTime || null,
          end_time: values.endTime || null,
          notes: values.notes.trim() || null,
          summary: values.summary.trim() || null,
          share_time: values.shareTime,
          share_date_precision: values.shareDatePrecision,
          ...(!id || !samePlace(values.place, baseline.current.place) ? placeFields(values.place) : {}),
          ...(id ? {} : { position: visits.length }),
        },
      });
      // A pinned copy holds the previous version of the visit.
      if (id) await offline.removeByResource("visit", id);
    },
    onSuccess: () => {
      close();
      setMessage(textNotice(() => m.owner_visit_saved()));
    },
  });

  function load(values: Values) {
    baseline.current = values;
    record.load(values);
  }
  function close() {
    dialog.close();
    load(blank());
  }
  function create() {
    load(blank());
    dialog.create();
  }
  function edit(visit: Visit) {
    load(fromVisit(visit));
    dialog.edit(visit.id);
  }
  const fail = (fallback: import("../query/api").ErrorFallback) => (error: unknown) =>
    setMessage(errorNotice(error, fallback));
  const failInDialog = (fallback: import("../query/api").ErrorFallback) => (error: unknown) => {
    dialog.setConfirmDelete(false);
    dialog.setError(errorNotice(error, fallback));
  };

  /** The map point for a visit: its location when that has a point, else its area. */
  const mapPointFor = (visit: Visit): string => (visit.location?.latitude != null ? visit.location.id : visit.area.id);

  function shift(visit: Visit, direction: -1 | 1) {
    const position = visit.position + direction;
    if (position < 0 || position >= visits.length) return;
    move
      .mutateAsync({ visit, position })
      .then(
        () => setMessage(textNotice(() => m.owner_visit_order_saved())),
        fail(m.owner_the_visit_could_not_be_moved),
      );
  }

  function erase(visit: Visit) {
    remove.mutateAsync(visit).then(async () => {
      await offline.removeByResource("visit", visit.id);
      close();
      setMessage(textNotice(() => m.owner_visit_deleted()));
    }, failInDialog(m.owner_the_visit_could_not_be_deleted));
  }

  async function toggleOffline(visit: Visit) {
    if (offline.isPinned("visit", visit.id)) {
      await offline.removeByResource("visit", visit.id);
      setMessage(textNotice(() => m.owner_is_no_longer_available_offline({ p0: visitTitle(visit) })));
      return;
    }
    await offline.pin({
      resourceKind: "visit",
      resourceId: visit.id,
      metadataUrl: `/api/trips/${trip.id}/visits/${visit.id}`,
      title: visitTitle(visit),
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(visit)).buffer as ArrayBuffer,
    });
    setMessage(textNotice(() => m.owner_is_saved_offline_on_this_device({ p0: visitTitle(visit) })));
  }

  const readError = visitsQuery.error ?? staysQuery.error;

  const dayLine = (visit: Visit) => {
    // "Gepland" is the default, so only an idea or a confirmed visit is called out.
    const tags = [
      visit.status !== "planned" ? STATUS_LABELS[visit.status] : "",
      visit.kind ? KIND_LABELS[visit.kind] : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return `${visitWhen(visit)}${tags ? ` · ${tags}` : ""}`;
  };

  /** Where the nights of a visit are spent. */
  function sleeping(visit: Visit) {
    const sleep = overnights(visit, stays, trip);
    if (!sleep.stays.length && !sleep.uncovered) return null;
    return (
      <div className="grid gap-0.75">
        <span className="text-sm font-medium text-travel-muted">
          {m.owner_overnight_stay()} {sleep.stays.map(stayLabel).join(", ") || "—"}
          {sleep.uncovered > 0 ? m.owner_uncovered_nights({ count: sleep.uncovered }) : ""}
        </span>
      </div>
    );
  }

  return (
    <section className="travel-card manager" id="visits" aria-labelledby="visits-title">
      <div className="capture-heading">
        <div>
          <h3 id="visits-title">{m.owner_visits()}</h3>
          <p>{m.owner_stops_on_your_trip_an_area_or_location_and_when_you_are_there_share_them()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.owner_new_visit()}
        </Button>
      </div>
      <p className="help" role="status">
        {readError
          ? errorMessage(readError, m.owner_your_visits_could_not_be_loaded)
          : visitsQuery.isPending
            ? m.owner_loading_your_visits()
            : message}
      </p>
      {visits.length > 0 && (
        <div className="saved-records mt-0.5">
          {visits.map((visit, index) => (
            <article className="excerpt-row" data-stacked="" key={visit.id}>
              <Button
                className="document-select"
                type="button"
                onClick={() => dialog.inspect(visit.id)}
                aria-label={m.owner_view_visit({ p0: visitTitle(visit) })}
              >
                <strong>{visitTitle(visit)}</strong>
                <span>{[dayLine(visit), visitPlace(visit), visibilityLabel(visit.visibility)].join(" · ")}</span>
              </Button>
              {sleeping(visit)}
              <RestatedRoutesNote routes={visit.possible_route_duplicates ?? []} />
              <div className="button-row">
                {onShowOnMap && (
                  <Button
                    className="secondary compact"
                    type="button"
                    onClick={() => onShowOnMap(mapPointFor(visit))}
                    aria-label={m.owner_show_on_map({ p0: visitTitle(visit) })}
                  >
                    {m.owner_show_on_map_2()}
                  </Button>
                )}
                <Button
                  className="secondary compact"
                  type="button"
                  onClick={() => void toggleOffline(visit).catch(fail(m.owner_the_visit_could_not_be_saved_offline))}
                  aria-label={
                    offline.isPinned("visit", visit.id)
                      ? m.owner_remove_visit_offline({ name: visitTitle(visit) })
                      : m.owner_save_visit_offline({ name: visitTitle(visit) })
                  }
                >
                  {offline.isPinned("visit", visit.id) ? m.owner_remove_offline_copy() : m.owner_save_offline()}
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  disabled={index === 0}
                  onClick={() => shift(visit, -1)}
                  aria-label={m.owner_move_up({ p0: visitTitle(visit) })}
                >
                  {m.owner_move_up_2()}
                </Button>
                <Button
                  className="secondary compact"
                  type="button"
                  disabled={index === visits.length - 1}
                  onClick={() => shift(visit, 1)}
                  aria-label={m.owner_move_down({ p0: visitTitle(visit) })}
                >
                  {m.owner_move_down_2()}
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      {!visitsQuery.isPending && !visitsQuery.error && visits.length === 0 && (
        <p>{m.owner_no_visits_yet_add_one_to_organise_your_trip()}</p>
      )}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? m.owner_edit_visit() : m.owner_add_visit()) : m.owner_visit()}
        dirty={editing && record.dirty}
        error={dialog.error}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{visitTitle(selected)}</h3>
              <p>{dayLine(selected)}</p>
              <p>{visitPlace(selected)}</p>
              {selected.summary && (
                <>
                  <p className="markdown-label">{m.owner_for_visitors()}</p>
                  <Markdown html={selected.summary_html} text={selected.summary} />
                </>
              )}
              {sleeping(selected)}
              <RestatedRoutesNote routes={selected.possible_route_duplicates ?? []} />
            </div>
            <div>
              <h4>{m.owner_only_for_you()}</h4>
              {selected.notes ? (
                <Markdown html={selected.notes_html} text={selected.notes} />
              ) : (
                <p className="help">{m.owner_no_private_note()}</p>
              )}
            </div>
            <VisibilityControl
              tripId={trip.id}
              kind="visit"
              id={selected.id}
              value={selected.visibility}
              name={visitTitle(selected)}
            />
            <p className="help">
              {selected.start_time
                ? selected.share_time
                  ? m.owner_visitors_also_see_the_time_because_you_selected_it_and_share_the_full_da()
                  : m.owner_the_time_stays_private()
                : m.owner_this_visit_has_no_time()}{" "}
              {m.owner_notes_always_stay_private()}
            </p>
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.owner_edit()}
              </Button>
              <Button className="danger" type="button" onClick={() => dialog.setConfirmDelete(true)}>
                {m.owner_delete()}
              </Button>
            </div>
            {dialog.confirmDelete && (
              <DeleteConfirmation
                title={m.owner_delete_visit({ p0: visitTitle(selected) })}
                onCancel={() => dialog.setConfirmDelete(false)}
                onConfirm={() => erase(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? m.owner_save_visit() : m.owner_add_visit()}
            pendingLabel={m.owner_saving()}
          >
            <record.form.Field name="place">
              {(field) => (
                <PlacePicker
                  tripId={trip.id}
                  label={m.owner_where()}
                  value={field.state.value}
                  onChange={(value) => field.handleChange(value)}
                />
              )}
            </record.form.Field>
            <record.form.Field name="title">
              {(field) => (
                <TextField
                  field={field}
                  label={m.owner_title()}
                  optional
                  maxLength={160}
                  placeholder={m.owner_without_a_title_the_visit_uses_the_place_name()}
                />
              )}
            </record.form.Field>
            <div className="field-row">
              <record.form.Field name="startsOn">
                {(field) => <DateField field={field} label={m.owner_first_day()} optional />}
              </record.form.Field>
              <record.form.Subscribe selector={(state) => state.values.startsOn}>
                {(startsOn) => (
                  <record.form.Field
                    name="endsOn"
                    validators={{ onChangeListenTo: ["startsOn"], onChange: lastDay, onSubmit: lastDay }}
                  >
                    {(field) => (
                      <DateField
                        field={field}
                        label={m.owner_last_day()}
                        optional
                        min={startsOn || undefined}
                        disabled={!startsOn}
                      />
                    )}
                  </record.form.Field>
                )}
              </record.form.Subscribe>
            </div>
            <record.form.Subscribe selector={(state) => state.values.startsOn}>
              {(startsOn) => (
                <div className="field-row">
                  <record.form.Field name="startTime">
                    {(field) => <TimeField field={field} label={m.owner_start_time()} optional disabled={!startsOn} />}
                  </record.form.Field>
                  <record.form.Field name="endTime">
                    {(field) => <TimeField field={field} label={m.owner_end_time()} optional disabled={!startsOn} />}
                  </record.form.Field>
                </div>
              )}
            </record.form.Subscribe>
            <p className="help">{m.owner_times_are_local_to_the_visit_in_the_area_s_time_zone_visitors_at_home_al()}</p>
            <div className="field-row">
              <record.form.Field name="status">
                {(field) => (
                  <SelectField field={field} label={m.owner_status()}>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
              <record.form.Field name="kind">
                {(field) => (
                  <SelectField field={field} label={m.owner_day_type()} optional>
                    <option value="">{m.owner_no_type()}</option>
                    {Object.entries(KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
            </div>
            <p className="help">{m.owner_the_status_is_only_for_you_and_is_never_shared_put_idea_or_draft_here_ra()}</p>
            <record.form.Field name="notes">
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.owner_notes()}
                  optional={m.owner_optional_always_private()}
                  maxLength={4000}
                  rows={3}
                />
              )}
            </record.form.Field>
            <record.form.Field name="summary">
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.owner_text_for_visitors()}
                  optional
                  maxLength={2000}
                  rows={3}
                  placeholder={m.owner_what_may_visitors_read_about_this_visit()}
                />
              )}
            </record.form.Field>
            <record.form.Subscribe
              selector={(state) => ({
                place: state.values.place,
                title: state.values.title,
                summary: state.values.summary,
                startsOn: state.values.startsOn,
                endsOn: state.values.endsOn,
              })}
            >
              {(draft) => <VisitRouteHint tripId={trip.id} draft={draft} />}
            </record.form.Subscribe>
            <div className="field-row">
              <record.form.Field name="shareDatePrecision">
                {(field) => (
                  <SelectField field={field} label={m.owner_dates_for_visitors()}>
                    {Object.entries(PRECISION_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </SelectField>
                )}
              </record.form.Field>
              <record.form.Field name="shareTime">
                {(field) => (
                  <CheckboxField
                    field={field}
                    label={
                      <>
                        {m.owner_show_the_time_to_visitors()} <small>{m.owner_only_with_full_dates()}</small>
                      </>
                    }
                  />
                )}
              </record.form.Field>
            </div>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
