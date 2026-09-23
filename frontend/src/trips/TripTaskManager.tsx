import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, localDateTime, type TaskLink, type TripTaskAlert, type TripTask, type Trip } from "../tracker-model";

const MAX_LINKS = 5;

function emptyDraft() {
  return { id: null as string | null, title: "", notes: "", dueDate: "", remindAt: "", links: [] as TaskLink[] };
}

function TaskLinks({ links }: { links: TaskLink[] }) {
  if (!links.length) return null;
  return <span className="task-links">{links.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">{link.label} ↗</a>)}</span>;
}

export function TripTaskManager({ trip, onChange }: { trip: Trip; onChange?: () => void }) {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<TripTask[]>([]);
  const [alerts, setAlerts] = useState<TripTaskAlert[]>([]);
  const [message, setMessage] = useState("Laad je private takenlijst…");
  const [draft, setDraft] = useState(emptyDraft());

  async function load() {
    if (!session) return;
    const [response, alertsResponse] = await Promise.all([
      fetch(`/api/trips/${trip.id}/trip-tasks`, { headers: apiHeaders(session) }),
      fetch(`/api/trips/${trip.id}/task-alerts`, { headers: apiHeaders(session) }),
    ]);
    if (!response.ok) return apiError(response, "Je taken konden niet worden geladen.");
    if (!alertsResponse.ok) return apiError(alertsResponse, "Je meldingen konden niet worden geladen.");
    setTasks(await response.json() as TripTask[]);
    setAlerts(await alertsResponse.json() as TripTaskAlert[]);
    setMessage("Openstaande boekingen en voorbereidingen blijven een private lijst.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je taken konden niet worden geladen.")); }, [session, trip.id]);

  function newTask() { setDraft(emptyDraft()); }

  function editTask(task: TripTask) {
    setDraft({ id: task.id, title: task.title, notes: task.notes ?? "", dueDate: task.due_date ?? "", remindAt: task.remind_at ? localDateTime(new Date(task.remind_at)) : "", links: task.links.map((link) => ({ ...link })) });
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const links = draft.links.map((link) => ({ label: link.label.trim(), url: link.url.trim() })).filter((link) => link.label || link.url);
    if (links.some((link) => !link.label || !link.url.startsWith("https://"))) throw new Error("Geef elke link een naam en een https-adres.");
    const payload = { title: draft.title.trim(), notes: draft.notes.trim() || null, due_date: draft.dueDate || null, remind_at: draft.remindAt ? new Date(draft.remindAt).toISOString() : null, links };
    const response = await fetch(draft.id ? `/api/trips/${trip.id}/trip-tasks/${draft.id}` : `/api/trips/${trip.id}/trip-tasks`, { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "De taak kon niet worden opgeslagen.");
    await load();
    onChange?.();
    newTask();
    setMessage("Taak opgeslagen.");
  }

  async function toggleTask(task: TripTask) {
    if (!session) return;
    const response = await fetch(`/api/trips/${trip.id}/trip-tasks/${task.id}`, { method: "PATCH", headers: apiHeaders(session), body: JSON.stringify({ completed: !task.completed_at }) });
    if (!response.ok) return apiError(response, "De taak kon niet worden bijgewerkt.");
    await load();
    onChange?.();
    setMessage(task.completed_at ? "Taak heropend." : "Taak afgevinkt.");
  }

  async function deleteTask(task: TripTask) {
    if (!session || !window.confirm(`Verwijder taak “${task.title}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/trip-tasks/${task.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De taak kon niet worden verwijderd.");
    await load();
    onChange?.();
    newTask();
    setMessage("Taak verwijderd.");
  }

  async function markRead(alert: TripTaskAlert) {
    if (!session) return;
    const response = await fetch(`/api/trips/${trip.id}/task-alerts/${alert.id}/read`, { method: "PATCH", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De melding kon niet worden bijgewerkt.");
    await load();
  }

  const openTasks = tasks.filter((task) => !task.completed_at).sort((left, right) => (left.due_date ?? "9999").localeCompare(right.due_date ?? "9999"));
  const completedTasks = tasks.filter((task) => task.completed_at);

  return <section className="card manager" aria-labelledby="tasks-title">
    <div className="capture-heading"><div><h3 id="tasks-title">Nog te regelen</h3><p>Een deadline sorteert taken. Kies apart een herinnering; meldingen verschijnen hier en worden per e-mail verstuurd zodra de geplande verwerking draait.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newTask}>Nieuwe taak</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveTask(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De taak kon niet worden opgeslagen."))}>
      <div className="field-row">
        <label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: Trein Taipei-Hualien boeken" /></label>
        <label>Deadline <span className="optional">(optioneel)</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
      </div>
      <div className="field-row">
        <label>Herinnering <span className="optional">(optioneel)</span><input type="datetime-local" value={draft.remindAt} onChange={(event) => setDraft((current) => ({ ...current, remindAt: event.target.value }))} /></label>
      </div>
      <label>Notities <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      <fieldset><legend>Links <span className="optional">(optioneel, https)</span></legend>
        {draft.links.map((link, index) => <div className="field-row" key={index}>
          <label>Naam<input maxLength={80} value={link.label} onChange={(event) => setDraft((current) => ({ ...current, links: current.links.map((value, position) => position === index ? { ...value, label: event.target.value } : value) }))} placeholder="Bijvoorbeeld: Taiwan HSR" /></label>
          <label>Adres<input type="url" pattern="https://.*" maxLength={2048} value={link.url} onChange={(event) => setDraft((current) => ({ ...current, links: current.links.map((value, position) => position === index ? { ...value, url: event.target.value } : value) }))} placeholder="https://" /></label>
          <button className="secondary compact" type="button" onClick={() => setDraft((current) => ({ ...current, links: current.links.filter((_, position) => position !== index) }))}>Link verwijderen</button>
        </div>)}
        {draft.links.length < MAX_LINKS && <button className="secondary compact" type="button" onClick={() => setDraft((current) => ({ ...current, links: [...current.links, { label: "", url: "" }] }))}>Link toevoegen</button>}
      </fieldset>
      <button type="submit">{draft.id ? "Taak opslaan" : "Taak toevoegen"}</button>
    </form>
    {alerts.length > 0 && <div className="manager-subsection"><h4>Meldingen</h4><div className="saved-moments manager-list">{alerts.map((alert) => <article className="excerpt-row" key={alert.id}><div><strong>{alert.title}</strong><span>Geplande herinnering{alert.read_at ? " · Gelezen" : " · Nieuw"}{alert.email_sent_at ? " · E-mail verzonden" : alert.email_attempts >= 5 ? " · E-mailbezorging mislukt" : " · E-mail nog niet verzonden"}</span></div>{!alert.read_at && <button className="secondary compact" type="button" onClick={() => void markRead(alert).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De melding kon niet worden bijgewerkt."))}>Gelezen</button>}</article>)}</div></div>}
    {tasks.length > 0 && <div className="saved-moments manager-list">
      {openTasks.map((task) => <article className="excerpt-row" key={task.id}>
        <div><strong>{task.title}</strong><span>{task.due_date ? `Voor ${task.due_date}` : "Geen deadline"}{task.remind_at ? ` · Herinnering ${new Intl.DateTimeFormat("nl-BE", { dateStyle: "short", timeStyle: "short" }).format(new Date(task.remind_at))}` : ""}{task.notes ? ` · ${task.notes}` : ""}</span><TaskLinks links={task.links} /></div>
        <div className="button-row">
          <button className="secondary compact" type="button" onClick={() => void toggleTask(task).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De taak kon niet worden bijgewerkt."))}>Afvinken</button>
          <button className="secondary compact" type="button" onClick={() => editTask(task)}>Bewerken</button>
          <button className="danger compact" type="button" onClick={() => void deleteTask(task).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De taak kon niet worden verwijderd."))}>Verwijderen</button>
        </div>
      </article>)}
      {completedTasks.map((task) => <article className="excerpt-row completed" key={task.id}>
        <div><strong>{task.title}</strong><span>Afgevinkt{task.due_date ? ` · was voor ${task.due_date}` : ""}</span></div>
        <div className="button-row">
          <button className="secondary compact" type="button" onClick={() => void toggleTask(task).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De taak kon niet worden bijgewerkt."))}>Heropenen</button>
          <button className="danger compact" type="button" onClick={() => void deleteTask(task).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De taak kon niet worden verwijderd."))}>Verwijderen</button>
        </div>
      </article>)}
    </div>}
    {!tasks.length && <p>Nog geen taken. Voeg er één toe zodra iets nog geboekt of geregeld moet worden.</p>}
  </section>;
}
