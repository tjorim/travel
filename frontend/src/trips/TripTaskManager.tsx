import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, type TripTask, type Trip } from "../tracker-model";

function emptyDraft() {
  return { id: null as string | null, title: "", notes: "", dueDate: "" };
}

export function TripTaskManager({ trip }: { trip: Trip }) {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<TripTask[]>([]);
  const [message, setMessage] = useState("Laad je private takenlijst…");
  const [draft, setDraft] = useState(emptyDraft());

  async function load() {
    if (!session) return;
    const response = await fetch(`/api/trips/${trip.id}/trip-tasks`, { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je taken konden niet worden geladen.");
    setTasks(await response.json() as TripTask[]);
    setMessage("Openstaande boekingen en voorbereidingen blijven een private lijst.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je taken konden niet worden geladen.")); }, [session, trip.id]);

  function newTask() { setDraft(emptyDraft()); }

  function editTask(task: TripTask) {
    setDraft({ id: task.id, title: task.title, notes: task.notes ?? "", dueDate: task.due_date ?? "" });
  }

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const payload = { title: draft.title.trim(), notes: draft.notes.trim() || null, due_date: draft.dueDate || null };
    const response = await fetch(draft.id ? `/api/trips/${trip.id}/trip-tasks/${draft.id}` : `/api/trips/${trip.id}/trip-tasks`, { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "De taak kon niet worden opgeslagen.");
    await load();
    newTask();
    setMessage("Taak opgeslagen.");
  }

  async function toggleTask(task: TripTask) {
    if (!session) return;
    const response = await fetch(`/api/trips/${trip.id}/trip-tasks/${task.id}`, { method: "PATCH", headers: apiHeaders(session), body: JSON.stringify({ completed: !task.completed_at }) });
    if (!response.ok) return apiError(response, "De taak kon niet worden bijgewerkt.");
    await load();
    setMessage(task.completed_at ? "Taak heropend." : "Taak afgevinkt.");
  }

  async function deleteTask(task: TripTask) {
    if (!session || !window.confirm(`Verwijder taak “${task.title}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/trip-tasks/${task.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De taak kon niet worden verwijderd.");
    await load();
    newTask();
    setMessage("Taak verwijderd.");
  }

  const openTasks = tasks.filter((task) => !task.completed_at).sort((left, right) => (left.due_date ?? "9999").localeCompare(right.due_date ?? "9999"));
  const completedTasks = tasks.filter((task) => task.completed_at);

  return <section className="card manager" aria-labelledby="tasks-title">
    <div className="capture-heading"><div><h3 id="tasks-title">Nog te regelen</h3><p>Lichte taken voor openstaande boekingen en voorbereiding. Uitsluitend zichtbaar voor jou.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newTask}>Nieuwe taak</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveTask(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De taak kon niet worden opgeslagen."))}>
      <div className="field-row">
        <label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: Trein Taipei-Hualien boeken" /></label>
        <label>Deadline <span className="optional">(optioneel)</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
      </div>
      <label>Notities <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      <button type="submit">{draft.id ? "Taak opslaan" : "Taak toevoegen"}</button>
    </form>
    {tasks.length > 0 && <div className="saved-moments manager-list">
      {openTasks.map((task) => <article className="excerpt-row" key={task.id}>
        <div><strong>{task.title}</strong><span>{task.due_date ? `Voor ${task.due_date}` : "Geen deadline"}{task.notes ? ` · ${task.notes}` : ""}</span></div>
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
