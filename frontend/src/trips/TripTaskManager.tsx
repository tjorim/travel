import { useState } from "react";

import { RecordForm, requiredText, TextField } from "../forms/fields";
import { MarkdownField } from "../forms/MarkdownField";
import { useDialogFocus, type DialogFocusRequest } from "../forms/useRecordDialog";
import { useRecordForm } from "../forms/useRecordForm";
import { Markdown } from "../Markdown";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { ownerKeys } from "../query/keys";
import { errorMessage } from "../query/api";
import { tripPath, useMarkAlertRead, useOwnerMutation, useTripResource } from "../query/owner-queries";
import { formatInstant, localDateTime, type TaskLink, type Trip, type TripTask } from "../tracker-model";

const MAX_LINKS = 5;
type Values = { title: string; notes: string; dueDate: string; remindAt: string; links: TaskLink[] };
const blank = (): Values => ({ title: "", notes: "", dueDate: "", remindAt: "", links: [] });
const fromTask = (task: TripTask): Values => ({ title: task.title, notes: task.notes ?? "", dueDate: task.due_date ?? "", remindAt: task.remind_at ? localDateTime(new Date(task.remind_at)) : "", links: task.links.map((link) => ({ ...link })) });
const serverFields = { title: "title", notes: "notes", due_date: "dueDate", remind_at: "remindAt" };

function TaskLinks({ links }: { links: TaskLink[] }) {
  return links.length ? <span className="task-links">{links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">{link.label} ↗</a>)}</span> : null;
}

const isHttps = (url: string) => url.trim().startsWith("https://");
const linkNameError = ({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } }, index: number) =>
  !value.trim() && String(fieldApi.form.getFieldValue(`links[${index}].url` as never) ?? "").trim() ? "Geef de link een naam." : undefined;
const linkUrlError = ({ value, fieldApi }: { value: string; fieldApi: { form: { getFieldValue: (name: never) => unknown } } }, index: number) => {
  const named = String(fieldApi.form.getFieldValue(`links[${index}].label` as never) ?? "").trim() !== "";
  if (!value.trim()) return named ? "Geef een https-adres op." : undefined;
  return isHttps(value) ? undefined : "Gebruik een https-adres.";
};

export function TripTaskManager({ trip, focusId }: { trip: Trip; focusId?: DialogFocusRequest | null }) {
  const tasksQuery = useTripResource(trip.id, "trip-tasks");
  const alertsQuery = useTripResource(trip.id, "task-alerts");
  const tasks = tasksQuery.data ?? [];
  const alerts = alertsQuery.data ?? [];
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const editing = editingId !== undefined;
  useDialogFocus(focusId, (id) => { setSelectedId(id); setEditingId(undefined); setConfirmDelete(false); });

  const taskKeys = (subject: string) => [ownerKeys.tripResource(subject, trip.id, "trip-tasks"), ownerKeys.tripResource(subject, trip.id, "task-alerts")];
  const saveTask = useOwnerMutation<{ id: string | null; payload: Record<string, unknown> }, TripTask>({
    fallback: "De taak kon niet worden opgeslagen.",
    request: ({ id, payload }) => ({ path: id ? `${tripPath(trip.id, "trip-tasks")}/${id}` : tripPath(trip.id, "trip-tasks"), method: id ? "PATCH" : "POST", body: payload }),
    invalidate: taskKeys,
  });
  const toggleTask = useOwnerMutation<TripTask, TripTask>({
    fallback: "De taak kon niet worden bijgewerkt.",
    request: (task) => ({ path: `${tripPath(trip.id, "trip-tasks")}/${task.id}`, method: "PATCH", body: { completed: !task.completed_at } }),
    invalidate: taskKeys,
    optimistic: {
      key: (subject) => ownerKeys.tripResource(subject, trip.id, "trip-tasks"),
      update: (current: TripTask[], task) => current.map((item) => item.id === task.id ? { ...item, completed_at: task.completed_at ? null : new Date().toISOString() } : item),
    },
  });
  const deleteTask = useOwnerMutation<TripTask>({
    fallback: "De taak kon niet worden verwijderd.",
    request: (task) => ({ path: `${tripPath(trip.id, "trip-tasks")}/${task.id}`, method: "DELETE" }),
    invalidate: taskKeys,
    optimistic: {
      key: (subject) => ownerKeys.tripResource(subject, trip.id, "trip-tasks"),
      update: (current: TripTask[], task) => current.filter((item) => item.id !== task.id),
    },
  });
  const markRead = useMarkAlertRead();

  const record = useRecordForm<Values>({
    defaultValues: blank(),
    fallback: "De taak kon niet worden opgeslagen.",
    serverFields,
    submit: async (values) => {
      const links = values.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label || link.url);
      await saveTask.mutateAsync({ id: editingId ?? null, payload: { title: values.title.trim(), notes: values.notes.trim() || null, due_date: values.dueDate || null, remind_at: values.remindAt ? new Date(values.remindAt).toISOString() : null, links } });
    },
    onSuccess: () => { close(); setNotice("Taak opgeslagen."); },
  });

  function close() { setSelectedId(null); setEditingId(undefined); setConfirmDelete(false); record.load(blank()); }
  function create() { record.load(blank()); setSelectedId(null); setEditingId(null); }
  function edit(task: TripTask) { record.load(fromTask(task)); setSelectedId(task.id); setEditingId(task.id); }
  function inspect(task: TripTask) { setSelectedId(task.id); setEditingId(undefined); setConfirmDelete(false); }

  const message = notice ?? (tasksQuery.error ? errorMessage(tasksQuery.error, "Je taken konden niet worden geladen.") : alertsQuery.error ? errorMessage(alertsQuery.error, "Je meldingen konden niet worden geladen.") : tasksQuery.isPending ? "Laad je private takenlijst…" : "Openstaande boekingen en voorbereidingen blijven een private lijst.");
  const fail = (fallback: string) => (error: unknown) => setNotice(errorMessage(error, fallback));
  const openTasks = tasks.filter((task) => !task.completed_at).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const completedTasks = tasks.filter((task) => task.completed_at);

  function toggle(task: TripTask) {
    toggleTask.mutateAsync(task).then(() => { setNotice(task.completed_at ? "Taak heropend." : "Taak afgevinkt."); }, fail("De taak kon niet worden bijgewerkt."));
  }
  function remove(task: TripTask) {
    deleteTask.mutateAsync(task).then(() => { close(); setNotice("Taak verwijderd."); }, fail("De taak kon niet worden verwijderd."));
  }

  const row = (task: TripTask) => <article key={task.id} className={`excerpt-row${task.completed_at ? " completed" : ""}`}>
    <button className="document-select" type="button" onClick={() => inspect(task)} aria-label={`Taak ${task.title} bekijken`}>
      <strong>{task.title}</strong>
      <span>{task.completed_at ? `Afgevinkt${task.due_date ? ` · was voor ${task.due_date}` : ""}` : `${task.due_date ? `Voor ${task.due_date}` : "Geen deadline"}${task.remind_at ? ` · Herinnering ${formatInstant(task.remind_at)}` : ""}`}</span>
    </button>
    <div className="button-row"><button className="secondary compact" type="button" onClick={() => toggle(task)}>{task.completed_at ? "Heropenen" : "Afvinken"}</button></div>
  </article>;

  return <section className="card manager" id="tasks" aria-labelledby="tasks-title">
    <div className="capture-heading"><div><h3 id="tasks-title">Nog te regelen</h3><p>Een deadline sorteert taken. Kies apart een herinnering; meldingen verschijnen hier en worden per e-mail verstuurd zodra de geplande verwerking draait.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuwe taak</button></div>
    <p className="help" role="status">{message}</p>
    {alerts.length > 0 && <div className="manager-subsection"><h4>Meldingen</h4><div className="saved-records manager-list">{alerts.map((alert) => <article className="excerpt-row" key={alert.id}><div><strong>{alert.title}</strong><span>Geplande herinnering{alert.read_at ? " · Gelezen" : " · Nieuw"}{alert.email_sent_at ? " · E-mail verzonden" : alert.email_attempts >= 5 ? " · E-mailbezorging mislukt" : " · E-mail nog niet verzonden"}</span></div>{!alert.read_at && <button className="secondary compact" type="button" onClick={() => markRead.mutateAsync({ tripId: trip.id, alertId: alert.id }).catch(fail("De melding kon niet worden bijgewerkt."))}>Gelezen</button>}</article>)}</div></div>}
    {tasks.length > 0 && <div className="saved-records manager-list">{openTasks.map(row)}{completedTasks.map(row)}</div>}
    {!tasksQuery.isPending && !tasks.length && <p>Nog geen taken. Voeg er één toe zodra iets nog geboekt of geregeld moet worden.</p>}
    <RecordDialog open={editing || selected !== null} title={editing ? (editingId ? "Taak bewerken" : "Taak toevoegen") : "Taak"} dirty={editing && record.dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form">
        <div><h3>{selected.title}</h3><Markdown html={selected.notes_html} text={selected.notes} /><TaskLinks links={selected.links} /></div>
        <div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => setConfirmDelete(true)}>Verwijderen</button></div>
        {confirmDelete && <DeleteConfirmation title={`Taak “${selected.title}” verwijderen?`} onCancel={() => setConfirmDelete(false)} onConfirm={() => remove(selected)} />}
      </div>}
      {editing && <RecordForm record={record} submitLabel={editingId ? "Taak opslaan" : "Taak toevoegen"} pendingLabel="Opslaan…">
        <div className="field-row">
          <record.form.Field name="title" validators={{ onChange: requiredText("Geef de taak een titel."), onSubmit: requiredText("Geef de taak een titel.") }}>{(field) => <TextField field={field} label="Titel" required maxLength={160} />}</record.form.Field>
          <record.form.Field name="dueDate">{(field) => <TextField field={field} label="Deadline" optional type="date" />}</record.form.Field>
        </div>
        <record.form.Field name="remindAt">{(field) => <TextField field={field} label="Herinnering" optional type="datetime-local" />}</record.form.Field>
        <record.form.Field name="notes">{(field) => <MarkdownField field={field} label="Notities" optional maxLength={4000} rows={3} />}</record.form.Field>
        <record.form.Field name="links" mode="array">{(links) => <fieldset>
          <legend>Links <span className="optional">(optioneel, https)</span></legend>
          {links.state.value.map((_, index) => <div className="field-row" key={index}>
            <record.form.Field name={`links[${index}].label`} validators={{ onBlur: (context) => linkNameError(context, index), onSubmit: (context) => linkNameError(context, index) }}>{(field) => <TextField field={field} label="Naam" maxLength={80} />}</record.form.Field>
            <record.form.Field name={`links[${index}].url`} validators={{ onBlur: (context) => linkUrlError(context, index), onSubmit: (context) => linkUrlError(context, index) }}>{(field) => <TextField field={field} label="Adres" type="url" maxLength={2048} />}</record.form.Field>
            <button className="secondary compact" type="button" onClick={() => void links.removeValue(index)}>Link verwijderen</button>
          </div>)}
          {links.state.value.length < MAX_LINKS && <button className="secondary compact" type="button" onClick={() => void links.pushValue({ label: "", url: "" })}>Link toevoegen</button>}
        </fieldset>}</record.form.Field>
      </RecordForm>}
    </RecordDialog>
  </section>;
}
