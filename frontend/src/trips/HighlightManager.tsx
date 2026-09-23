import { useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, type Trip, type TripHighlight } from "../tracker-model";

export function HighlightManager({ trip, onChange }: { trip: Trip; onChange: () => Promise<void> }) {
  const { session } = useAuth();
  const [draft, setDraft] = useState({ id: null as string | null, title: "", summary: "" });
  const [message, setMessage] = useState("Hoogtepunten zijn korte, deelbare teksten. Ze verschijnen pas wanneer je ze in een publicatie kiest.");
  const highlights = trip.highlights.slice().sort((left, right) => left.position - right.position);

  function newHighlight() { setDraft({ id: null, title: "", summary: "" }); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const payload = { title: draft.title.trim(), summary: draft.summary.trim() || null };
    const response = await fetch(draft.id ? `/api/trips/${trip.id}/highlights/${draft.id}` : `/api/trips/${trip.id}/highlights`, { method: draft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload) });
    if (!response.ok) return apiError(response, "Het hoogtepunt kon niet worden opgeslagen.");
    await onChange();
    newHighlight();
    setMessage("Hoogtepunt opgeslagen. Het is nog niet gedeeld.");
  }

  async function move(highlight: TripHighlight, direction: -1 | 1) {
    if (!session) return;
    const position = highlight.position + direction;
    if (position < 0 || position >= highlights.length) return;
    const response = await fetch(`/api/trips/${trip.id}/highlights/${highlight.id}`, { method: "PATCH", headers: apiHeaders(session), body: JSON.stringify({ position }) });
    if (!response.ok) return apiError(response, "Het hoogtepunt kon niet worden verplaatst.");
    await onChange();
  }

  async function remove(highlight: TripHighlight) {
    if (!session || !window.confirm(`Verwijder hoogtepunt “${highlight.title}”?`)) return;
    const response = await fetch(`/api/trips/${trip.id}/highlights/${highlight.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het hoogtepunt kon niet worden verwijderd.");
    await onChange();
    newHighlight();
    setMessage("Hoogtepunt verwijderd.");
  }

  const fail = (fallback: string) => (error: unknown) => setMessage(error instanceof Error ? error.message : fallback);

  return <section className="card manager" aria-labelledby="highlights-title">
    <div className="capture-heading"><div><h3 id="highlights-title">Hoogtepunten</h3><p>Wat maakt deze reis bijzonder? Schrijf het apart, zodat je het bewust kunt delen.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newHighlight}>Nieuw hoogtepunt</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void save(event).catch(fail("Het hoogtepunt kon niet worden opgeslagen."))}>
      <label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: Stad ↔ natuur" /></label>
      <label>Korte tekst <span className="optional">(optioneel)</span><textarea maxLength={2000} rows={2} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
      <button type="submit">{draft.id ? "Hoogtepunt opslaan" : "Hoogtepunt toevoegen"}</button>
    </form>
    {highlights.length > 0 && <div className="saved-moments manager-list">{highlights.map((highlight, index) => <article className="excerpt-row" key={highlight.id}><div><strong>{highlight.title}</strong>{highlight.summary && <span>{highlight.summary}</span>}</div><div className="button-row"><button className="secondary compact" type="button" disabled={index === 0} onClick={() => void move(highlight, -1).catch(fail("Het hoogtepunt kon niet worden verplaatst."))}>Omhoog</button><button className="secondary compact" type="button" disabled={index === highlights.length - 1} onClick={() => void move(highlight, 1).catch(fail("Het hoogtepunt kon niet worden verplaatst."))}>Omlaag</button><button className="secondary compact" type="button" onClick={() => setDraft({ id: highlight.id, title: highlight.title, summary: highlight.summary ?? "" })}>Bewerken</button><button className="danger compact" type="button" onClick={() => void remove(highlight).catch(fail("Het hoogtepunt kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
  </section>;
}
