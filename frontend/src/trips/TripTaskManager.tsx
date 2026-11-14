import { isOverdue, tripDay } from "./readiness";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { textNotice, errorNotice, useFeedback } from "../query/feedback";
import { Button } from "@/ui/button";
import { useState } from "react";

import { DateField, DateTimeField } from "../forms/DateTimeFields";
import { RecordForm, requiredText, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { ownerKeys } from "../query/keys";
import { errorMessage } from "../query/api";
import {
  tripPath,
  useMarkAlertRead,
  useOwnerMutation,
  useTripResource,
} from "../query/owner-queries";
import { formatInstant, formatDay, localDateTime } from "../dates";
import { type TaskLink, type Trip, type TripTask } from "../api-types";
import { FieldSet, FieldLegend } from "@/ui/field";

const MAX_LINKS = 5;
type Values = {
  title: string;
  notes: string;
  dueDate: string;
  remindAt: string;
  links: TaskLink[];
};
const blank = (): Values => ({ title: "", notes: "", dueDate: "", remindAt: "", links: [] });
const fromTask = (task: TripTask): Values => ({
  title: task.title,
  notes: task.notes ?? "",
  dueDate: task.due_date ?? "",
  remindAt: task.remind_at ? localDateTime(new Date(task.remind_at)) : "",
  links: task.links.map((link) => ({ ...link })),
});
const serverFields = { title: "title", notes: "notes", due_date: "dueDate", remind_at: "remindAt" };

function TaskLinks({ links }: { links: TaskLink[] }) {
  useLocale();
  return links.length ? (
    <span className="flex flex-wrap gap-2 [&_a]:font-bold [&_a]:text-travel-link">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          referrerPolicy="no-referrer"
        >
          {link.label} ↗
        </a>
      ))}
    </span>
  ) : null;
}

const isHttps = (url: string) => url.trim().startsWith("https://");
const linkNameError = (
  {
    value,
    fieldApi,
  }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } },
  index: number,
) =>
  !value.trim() && String(fieldApi.form.getFieldValue(`links[${index}].url` as never) ?? "").trim()
    ? m.common_give_the_link_a_name
    : undefined;
const linkUrlError = (
  {
    value,
    fieldApi,
  }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } },
  index: number,
) => {
  const named =
    String(fieldApi.form.getFieldValue(`links[${index}].label` as never) ?? "").trim() !== "";
  if (!value.trim()) return named ? m.tasks_enter_an_https_address : undefined;
  return isHttps(value) ? undefined : m.common_use_an_https_address;
};

export function TripTaskManager({
  trip,
  focusId,
}: {
  trip: Trip;
  focusId?: DialogFocusRequest | null;
}) {
  useLocale();
  const tasksQuery = useTripResource(trip.id, "trip-tasks");
  const alertsQuery = useTripResource(trip.id, "task-alerts");
  const tasks = tasksQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];
  const [notice, setNotice] = useFeedback<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useFeedback<string | null>(null);
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const editing = editingId !== undefined;
  useDialogFocus(focusId, (id) => {
    setSelectedId(id);
    setEditingId(undefined);
    setConfirmDelete(false);
    setDeleteError(null);
  });

  const taskKeys = (subject: string) => [
    ownerKeys.tripResource(subject, trip.id, "trip-tasks"),
    ownerKeys.tripResource(subject, trip.id, "task-alerts"),
  ];
  const saveTask = useOwnerMutation<
    { id: string | null; payload: Record<string, unknown> },
    TripTask
  >({
    fallback: m.tasks_the_task_could_not_be_saved,
    request: ({ id, payload }) => ({
      path: id ? `${tripPath(trip.id, "trip-tasks")}/${id}` : tripPath(trip.id, "trip-tasks"),
      method: id ? "PATCH" : "POST",
      body: payload,
    }),
    invalidate: taskKeys,
  });
  const toggleTask = useOwnerMutation<TripTask, TripTask>({
    fallback: m.tasks_the_task_could_not_be_updated,
    request: (task) => ({
      path: `${tripPath(trip.id, "trip-tasks")}/${task.id}`,
      method: "PATCH",
      body: { completed: !task.completed_at },
    }),
    invalidate: taskKeys,
    optimistic: {
      key: (subject) => ownerKeys.tripResource(subject, trip.id, "trip-tasks"),
      update: (current: TripTask[], task) =>
        current.map((item) =>
          item.id === task.id
            ? { ...item, completed_at: task.completed_at ? null : new Date().toISOString() }
            : item,
        ),
    },
  });
  const deleteTask = useOwnerMutation<TripTask>({
    fallback: m.tasks_the_task_could_not_be_deleted,
    request: (task) => ({
      path: `${tripPath(trip.id, "trip-tasks")}/${task.id}`,
      method: "DELETE",
    }),
    invalidate: taskKeys,
    optimistic: {
      key: (subject) => ownerKeys.tripResource(subject, trip.id, "trip-tasks"),
      update: (current: TripTask[], task) => current.filter((item) => item.id !== task.id),
    },
  });
  const markRead = useMarkAlertRead();

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: m.tasks_the_task_could_not_be_saved,
    serverFields,
    submit: async (values) => {
      const links = values.links
        .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
        .filter((link) => link.label || link.url);
      await saveTask.mutateAsync({
        id: editingId ?? null,
        payload: {
          title: values.title.trim(),
          notes: values.notes.trim() || null,
          due_date: values.dueDate || null,
          remind_at: values.remindAt ? new Date(values.remindAt).toISOString() : null,
          links,
        },
      });
    },
    onSuccess: () => {
      close();
      setNotice(textNotice(() => m.tasks_task_saved()));
    },
  });

  function close() {
    setSelectedId(null);
    setEditingId(undefined);
    setConfirmDelete(false);
    setDeleteError(null);
    record.load(blank());
  }
  function create() {
    record.load(blank());
    setSelectedId(null);
    setEditingId(null);
  }
  function edit(task: TripTask) {
    record.load(fromTask(task));
    setSelectedId(task.id);
    setEditingId(task.id);
  }
  function inspect(task: TripTask) {
    setSelectedId(task.id);
    setEditingId(undefined);
    setConfirmDelete(false);
  }

  const message =
    notice ??
    (tasksQuery.error
      ? errorMessage(tasksQuery.error, m.tasks_your_tasks_could_not_be_loaded)
      : alertsQuery.error
        ? errorMessage(alertsQuery.error, m.tasks_your_notifications_could_not_be_loaded)
        : tasksQuery.isPending
          ? m.tasks_loading_your_private_task_list()
          : m.tasks_intro());
  const fail = (fallback: import("../query/api").ErrorFallback) => (error: unknown) =>
    setNotice(errorNotice(error, fallback));
  const readinessStays = useTripResource(trip.id, "stays").data ?? [];
  const readinessRoutes = useTripResource(trip.id, "routes").data ?? [];
  const today = tripDay(new Date(), readinessStays, readinessRoutes);
  const openTasks = tasks
    .filter((task) => !task.completed_at)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const completedTasks = tasks.filter((task) => task.completed_at);

  function toggle(task: TripTask) {
    toggleTask.mutateAsync(task).then(() => {
      setNotice(
        textNotice(() =>
          task.completed_at ? m.tasks_task_reopened() : m.tasks_task_checked_off(),
        ),
      );
    }, fail(m.tasks_the_task_could_not_be_updated));
  }
  function remove(task: TripTask) {
    deleteTask.mutateAsync(task).then(
      () => {
        close();
        setNotice(textNotice(() => m.tasks_task_deleted()));
      },
      (error: unknown) => {
        setConfirmDelete(false);
        setDeleteError(errorNotice(error, m.tasks_the_task_could_not_be_deleted));
      },
    );
  }

  function taskSummary(task: TripTask) {
    const due = task.due_date ? formatDay(task.due_date) : null;
    if (task.completed_at)
      return due ? m.tasks_checked_off_was_due({ due }) : m.tasks_checked_off();
    const reminder = task.remind_at ? formatInstant(task.remind_at) : null;
    if (due) return reminder ? m.tasks_due_with_reminder({ due, reminder }) : m.tasks_due({ due });
    return reminder ? m.tasks_no_deadline_with_reminder({ reminder }) : m.tasks_no_deadline();
  }

  const row = (task: TripTask) => (
    <article
      key={task.id}
      className="excerpt-row"
      data-completed={task.completed_at ? "" : undefined}
    >
      <Button className="document-select" type="button" onClick={() => inspect(task)}>
        <strong>{task.title}</strong>
        {isOverdue(task, today) && (
          <strong
            role="note"
            className="block text-travel-danger"
            aria-label={m.task_overdue({ title: task.title })}
          >
            {m.task_overdue_label()}
          </strong>
        )}
        <span>{taskSummary(task)}</span>
      </Button>
      <div className="button-row">
        <Button
          className="secondary compact"
          type="button"
          onClick={() => toggle(task)}
          aria-label={
            task.completed_at
              ? m.tasks_reopen_task({ title: task.title })
              : m.tasks_check_off_task({ title: task.title })
          }
        >
          {task.completed_at ? m.tasks_reopen() : m.tasks_check_off()}
        </Button>
      </div>
    </article>
  );

  return (
    <section
      className="travel-card manager"
      aria-labelledby="tasks-title"
      tabIndex={-1}
      data-section-focus=""
    >
      <div className="capture-heading">
        <div>
          <h3 id="tasks-title">{m.tasks_things_to_arrange()}</h3>
          <p>{m.tasks_deadline_hint()}</p>
        </div>
        <Button className="secondary compact" type="button" onClick={create}>
          {m.tasks_new_task()}
        </Button>
      </div>
      <p className="help" role="status">
        {message}
      </p>
      {alerts.length > 0 && (
        <div className="manager-subsection">
          <h4>{m.tasks_notifications()}</h4>
          <div className="saved-records mt-0.5">
            {alerts.map((alert) => (
              <article className="excerpt-row" key={alert.id}>
                <div>
                  <strong>{alert.title}</strong>
                  <span>
                    {m.tasks_notification_status({
                      state: alert.read_at
                        ? m.tasks_notification_state_read()
                        : m.tasks_notification_state_new(),
                      delivery: alert.email_sent_at
                        ? m.tasks_email_sent()
                        : alert.email_attempts >= 5
                          ? m.tasks_email_delivery_failed()
                          : m.tasks_email_not_sent_yet(),
                    })}
                  </span>
                </div>
                {!alert.read_at && (
                  <Button
                    className="secondary compact"
                    type="button"
                    onClick={() =>
                      markRead
                        .mutateAsync({ tripId: trip.id, alertId: alert.id })
                        .catch(fail(m.common_the_notification_could_not_be_updated))
                    }
                  >
                    {m.common_read()}
                  </Button>
                )}
              </article>
            ))}
          </div>
        </div>
      )}
      {tasks.length > 0 && (
        <div className="saved-records mt-0.5">
          {openTasks.map(row)}
          {completedTasks.map(row)}
        </div>
      )}
      {!tasksQuery.isPending && !tasks.length && <p>{m.tasks_empty()}</p>}
      <RecordDialog
        open={editing || selected !== null}
        title={editing ? (editingId ? m.tasks_edit_task() : m.tasks_add_task()) : m.common_task()}
        dirty={editing && record.dirty}
        error={deleteError}
        onDismiss={close}
      >
        {!editing && selected && (
          <div className="stack-form">
            <div>
              <h3>{selected.title}</h3>
              <Markdown html={selected.notes_html} text={selected.notes} />
              <TaskLinks links={selected.links} />
            </div>
            <div className="button-row">
              <Button type="button" onClick={() => edit(selected)}>
                {m.common_edit()}
              </Button>
              <Button className="danger" type="button" onClick={() => setConfirmDelete(true)}>
                {m.common_delete()}
              </Button>
            </div>
            {confirmDelete && (
              <DeleteConfirmation
                title={m.tasks_delete_task({ title: selected.title })}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => remove(selected)}
              />
            )}
          </div>
        )}
        {editing && (
          <RecordForm
            record={record}
            submitLabel={editingId ? m.tasks_save_task() : m.tasks_add_task()}
            pendingLabel={m.common_saving()}
          >
            <div className="field-row">
              <record.form.Field
                name="title"
                validators={{
                  onChange: requiredText(m.tasks_give_the_task_a_title),
                  onSubmit: requiredText(m.tasks_give_the_task_a_title),
                }}
              >
                {(field) => (
                  <TextField field={field} label={m.common_title()} required maxLength={160} />
                )}
              </record.form.Field>
              <record.form.Field name="dueDate">
                {(field) => <DateField field={field} label={m.tasks_deadline()} optional />}
              </record.form.Field>
            </div>
            <record.form.Field name="remindAt">
              {(field) => <DateTimeField field={field} label={m.tasks_reminder_label()} optional />}
            </record.form.Field>
            <record.form.Field name="notes">
              {(field) => (
                <MarkdownField
                  field={field}
                  label={m.common_notes()}
                  optional
                  maxLength={4000}
                  rows={3}
                />
              )}
            </record.form.Field>
            <record.form.Field name="links" mode="array">
              {(links) => (
                <FieldSet>
                  <FieldLegend>
                    {m.tasks_links()}{" "}
                    <span className="font-medium text-travel-optional">
                      {m.common_optional_https()}
                    </span>
                  </FieldLegend>
                  {links.state.value.map((_, index) => (
                    <div className="field-row" key={index}>
                      <record.form.Field
                        name={`links[${index}].label`}
                        validators={{
                          onBlur: (context) => linkNameError(context, index),
                          onSubmit: (context) => linkNameError(context, index),
                        }}
                      >
                        {(field) => (
                          <TextField field={field} label={m.common_name()} maxLength={80} />
                        )}
                      </record.form.Field>
                      <record.form.Field
                        name={`links[${index}].url`}
                        validators={{
                          onBlur: (context) => linkUrlError(context, index),
                          onSubmit: (context) => linkUrlError(context, index),
                        }}
                      >
                        {(field) => (
                          <TextField
                            field={field}
                            label={m.common_address()}
                            type="url"
                            maxLength={2048}
                          />
                        )}
                      </record.form.Field>
                      <Button
                        className="secondary compact"
                        type="button"
                        onClick={() => void links.removeValue(index)}
                      >
                        {m.tasks_remove_link()}
                      </Button>
                    </div>
                  ))}
                  {links.state.value.length < MAX_LINKS && (
                    <Button
                      className="secondary compact"
                      type="button"
                      onClick={() => void links.pushValue({ label: "", url: "" })}
                    >
                      {m.tasks_add_link()}
                    </Button>
                  )}
                </FieldSet>
              )}
            </record.form.Field>
          </RecordForm>
        )}
      </RecordDialog>
    </section>
  );
}
