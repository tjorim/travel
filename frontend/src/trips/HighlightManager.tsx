import { useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { DeleteConfirmation, RecordDialog } from "../RecordDialog";
import { apiError, apiHeaders, type Trip, type TripHighlight } from "../tracker-model";

type Draft = { id: string | null; title: string; summary: string };
const emptyDraft = (): Draft => ({ id: null, title: "", summary: "" });
const draftFor = (item: TripHighlight): Draft => ({ id: item.id, title: item.title, summary: item.summary ?? "" });

export function HighlightManager({ trip, onChange }: { trip: Trip; onChange: () => Promise<void> }) {
  const { session } = useAuth();
  const [draft, setDraft] = useState<Draft>(emptyDraft()); const [initial, setInitial] = useState<Draft>(emptyDraft());
  const [selected, setSelected] = useState<TripHighlight | null>(null); const [editing, setEditing] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("Hoogtepunten zijn korte, deelbare teksten. Ze verschijnen pas wanneer je ze in een publicatie kiest.");
  const highlights = trip.highlights.slice().sort((a, b) => a.position - b.position);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  function close() { setSelected(null); setEditing(false); setConfirmDelete(false); setDraft(emptyDraft()); setInitial(emptyDraft()); }
  function create() { const next = emptyDraft(); setDraft(next); setInitial(next); setSelected(null); setEditing(true); }
  function inspect(item: TripHighlight) { setSelected(item); setEditing(false); setConfirmDelete(false); }
  function edit(item: TripHighlight) { const next = draftFor(item); setDraft(next); setInitial(next); setSelected(item); setEditing(true); }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!session) return; const payload = { title: draft.title.trim(), summary: draft.summary.trim() || null }; const response = await fetch(draft.id ? `/api/trips/${trip.id}/highlights/${draft.id}` : `/api/trips/${trip.id}/highlights`, { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) }); if (!response.ok) return apiError(response, "Het hoogtepunt kon niet worden opgeslagen."); await onChange(); close(); setMessage("Hoogtepunt opgeslagen. Het is nog niet gedeeld."); }
  async function move(item: TripHighlight, direction: -1 | 1) { if (!session) return; const position = item.position + direction; if (position < 0 || position >= highlights.length) return; const response = await fetch(`/api/trips/${trip.id}/highlights/${item.id}`, { method: "PATCH", headers: apiHeaders(session), body: JSON.stringify({ position }) }); if (!response.ok) return apiError(response, "Het hoogtepunt kon niet worden verplaatst."); await onChange(); }
  async function remove(item: TripHighlight) { if (!session) return; const response = await fetch(`/api/trips/${trip.id}/highlights/${item.id}`, { method: "DELETE", headers: apiHeaders(session) }); if (!response.ok) return apiError(response, "Het hoogtepunt kon niet worden verwijderd."); await onChange(); close(); setMessage("Hoogtepunt verwijderd."); }
  const fail = (fallback: string) => (error: unknown) => setMessage(error instanceof Error ? error.message : fallback);
  return <section className="card manager" aria-labelledby="highlights-title"><div className="capture-heading"><div><h3 id="highlights-title">Hoogtepunten</h3><p>Wat maakt deze reis bijzonder? Schrijf het apart, zodat je het bewust kunt delen.</p></div><button className="secondary compact" type="button" onClick={create}>Nieuw hoogtepunt</button></div><p className="help" role="status">{message}</p>
    {highlights.length > 0 && <div className="saved-moments manager-list">{highlights.map((item, index) => <article className="excerpt-row" key={item.id}><button className="document-select" type="button" onClick={() => inspect(item)} aria-label={`Hoogtepunt ${item.title} bekijken`}><strong>{item.title}</strong>{item.summary && <span>{item.summary}</span>}</button><div className="button-row"><button className="secondary compact" type="button" disabled={index === 0} onClick={() => void move(item, -1).catch(fail("Het hoogtepunt kon niet worden verplaatst."))}>Omhoog</button><button className="secondary compact" type="button" disabled={index === highlights.length - 1} onClick={() => void move(item, 1).catch(fail("Het hoogtepunt kon niet worden verplaatst."))}>Omlaag</button></div></article>)}</div>}
    <RecordDialog open={editing || selected !== null} title={editing ? (draft.id ? "Hoogtepunt bewerken" : "Hoogtepunt toevoegen") : "Hoogtepunt"} dirty={editing && dirty} onDismiss={close}>
      {!editing && selected && <div className="stack-form"><div><h3>{selected.title}</h3>{selected.summary && <p>{selected.summary}</p>}</div><div className="button-row"><button type="button" onClick={() => edit(selected)}>Bewerken</button><button className="danger" type="button" onClick={() => setConfirmDelete(true)}>Verwijderen</button></div>{confirmDelete && <DeleteConfirmation title={`Hoogtepunt “${selected.title}” verwijderen?`} onCancel={() => setConfirmDelete(false)} onConfirm={() => void remove(selected).catch(fail("Het hoogtepunt kon niet worden verwijderd."))} />}</div>}
      {editing && <form className="stack-form" onSubmit={(event) => void save(event).catch(fail("Het hoogtepunt kon niet worden opgeslagen."))}><label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: Stad ↔ natuur" /></label><label>Korte tekst <span className="optional">(optioneel)</span><textarea maxLength={2000} rows={2} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label><button type="submit">{draft.id ? "Hoogtepunt opslaan" : "Hoogtepunt toevoegen"}</button></form>}
    </RecordDialog></section>;
}
