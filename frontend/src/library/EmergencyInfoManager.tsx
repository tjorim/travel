import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, type EmergencyInfoEntry, type EmergencyInfoKind } from "../tracker-model";

const KIND_LABELS: Record<EmergencyInfoKind, string> = {
  contact: "Contactpersoon",
  number: "Telefoonnummer",
  medical_note: "Medische notitie",
};

function emptyDraft() {
  return { id: null as string | null, kind: "contact" as EmergencyInfoKind, label: "", value: "", notes: "" };
}

export function EmergencyInfoManager() {
  const { session } = useAuth();
  const [entries, setEntries] = useState<EmergencyInfoEntry[]>([]);
  const [message, setMessage] = useState("Laad je noodinformatie…");
  const [draft, setDraft] = useState(emptyDraft());

  async function load() {
    if (!session) return;
    const response = await fetch("/api/library/emergency-info", { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je noodinformatie kon niet worden geladen.");
    setEntries(await response.json() as EmergencyInfoEntry[]);
    setMessage("Contacten, nummers en medische notities blijven uitsluitend voor jou zichtbaar.");
  }

  useEffect(() => { void load().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je noodinformatie kon niet worden geladen.")); }, [session]);

  function newEntry() { setDraft(emptyDraft()); }

  function editEntry(entry: EmergencyInfoEntry) {
    setDraft({ id: entry.id, kind: entry.kind, label: entry.label, value: entry.value, notes: entry.notes ?? "" });
  }

  async function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const payload = { kind: draft.kind, label: draft.label.trim(), value: draft.value.trim(), notes: draft.notes.trim() || null };
    const response = await fetch(draft.id ? `/api/library/emergency-info/${draft.id}` : "/api/library/emergency-info", { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "De noodinformatie kon niet worden opgeslagen.");
    await load();
    newEntry();
    setMessage("Noodinformatie opgeslagen.");
  }

  async function deleteEntry(entry: EmergencyInfoEntry) {
    if (!session || !window.confirm(`Verwijder “${entry.label}”?`)) return;
    const response = await fetch(`/api/library/emergency-info/${entry.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De noodinformatie kon niet worden verwijderd.");
    await load();
    newEntry();
    setMessage("Noodinformatie verwijderd.");
  }

  return <section className="card manager" aria-labelledby="emergency-info-title">
    <div className="capture-heading"><div><h3 id="emergency-info-title">Noodinformatie</h3><p>Contacten, relevante nummers en beknopte medische of hulpverlenersnotities, los van één specifieke reis.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newEntry}>Nieuwe invoer</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveEntry(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De noodinformatie kon niet worden opgeslagen."))}>
      <div className="field-row">
        <label>Soort<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as EmergencyInfoKind }))}><option value="contact">Contactpersoon</option><option value="number">Telefoonnummer</option><option value="medical_note">Medische notitie</option></select></label>
        <label>Label<input required maxLength={160} value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Bijvoorbeeld: Mama, Ambassade, Allergie" /></label>
      </div>
      <label>Waarde<input required maxLength={255} value={draft.value} onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))} placeholder="Telefoonnummer of korte omschrijving" /></label>
      <label>Notities <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
      <button type="submit">{draft.id ? "Opslaan" : "Toevoegen"}</button>
    </form>
    {entries.length > 0 && <div className="saved-moments manager-list">{entries.map((entry) => <article className="excerpt-row" key={entry.id}>
      <div><strong>{entry.label}</strong><span>{KIND_LABELS[entry.kind]} · {entry.value}{entry.notes ? ` · ${entry.notes}` : ""}</span></div>
      <div className="button-row">
        <button className="secondary compact" type="button" onClick={() => editEntry(entry)}>Bewerken</button>
        <button className="danger compact" type="button" onClick={() => void deleteEntry(entry).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De noodinformatie kon niet worden verwijderd."))}>Verwijderen</button>
      </div>
    </article>)}</div>}
    {!entries.length && <p>Nog geen noodinformatie. Voeg een contact, nummer of medische notitie toe.</p>}
  </section>;
}
