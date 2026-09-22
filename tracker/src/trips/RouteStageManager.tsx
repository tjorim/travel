import { useState, type FormEvent } from "react";

import { useAuth } from "../auth-context";
import { apiError, apiHeaders, type BroadPlace, type RouteStage, type Trip } from "../tracker-model";

export function RouteStageManager({ trip, broadPlaces, onChange }: { trip: Trip; broadPlaces: BroadPlace[]; onChange: () => Promise<void> }) {
  const { session } = useAuth();
  const [draft, setDraft] = useState({ id: null as string | null, broadPlaceId: "", label: "" });
  const [message, setMessage] = useState("Route-etappes zijn bewust algemeen; exacte plaatsen kunnen hier niet gekozen worden.");
  const stages = trip.route_stages.slice().sort((left, right) => left.position - right.position);

  function newStage() { setDraft({ id: null, broadPlaceId: "", label: "" }); }

  function editStage(stage: RouteStage) {
    setDraft({ id: stage.id, broadPlaceId: stage.place.id, label: stage.label ?? "" });
  }

  async function saveStage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    if (!draft.broadPlaceId) throw new Error("Kies eerst een brede plaats.");
    const endpoint = draft.id ? `/api/v1/trips/${trip.id}/route-stages/${draft.id}` : `/api/v1/trips/${trip.id}/route-stages`;
    const response = await fetch(endpoint, {
      method: draft.id ? "PATCH" : "POST",
      headers: apiHeaders(session),
      body: JSON.stringify(draft.id
        ? { broad_place_id: draft.broadPlaceId, label: draft.label.trim() || null }
        : { broad_place_id: draft.broadPlaceId, position: stages.length, label: draft.label.trim() || null }),
    });
    if (!response.ok) return apiError(response, "De route-etappe kon niet worden opgeslagen.");
    await onChange();
    newStage();
    setMessage("Route-etappe opgeslagen. Hij blijft privé totdat je hem expliciet deelt.");
  }

  async function moveStage(stage: RouteStage, direction: -1 | 1) {
    if (!session) return;
    const nextPosition = stage.position + direction;
    if (nextPosition < 0 || nextPosition >= stages.length) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/route-stages/${stage.id}`, {
      method: "PATCH", headers: apiHeaders(session), body: JSON.stringify({ position: nextPosition }),
    });
    if (!response.ok) return apiError(response, "De route-etappe kon niet worden verplaatst.");
    await onChange();
    setMessage("Volgorde van de route-etappes opgeslagen.");
  }

  async function deleteStage(stage: RouteStage) {
    if (!session || !window.confirm(`Verwijder route-etappe “${stage.label ?? stage.place.label}”?`)) return;
    const response = await fetch(`/api/v1/trips/${trip.id}/route-stages/${stage.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De route-etappe kon niet worden verwijderd.");
    await onChange();
    newStage();
    setMessage("Route-etappe verwijderd.");
  }

  return <section className="card manager" aria-labelledby="route-stages-title">
    <div className="capture-heading"><div><h3 id="route-stages-title">Route-etappes</h3><p>Elke etappe verwijst naar een bewust brede plaats. Je kiest zelf later of je die deelt.</p></div>{draft.id && <button className="secondary compact" type="button" onClick={newStage}>Nieuwe etappe</button>}</div>
    <p className="help" role="status">{message}</p>
    <form className="stack-form" onSubmit={(event) => void saveStage(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De route-etappe kon niet worden opgeslagen."))}>
      <label>Brede plaats<select required value={draft.broadPlaceId} onChange={(event) => setDraft((current) => ({ ...current, broadPlaceId: event.target.value }))}><option value="">Kies een brede plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}{place.region ? ` · ${place.region}` : ""}</option>)}</select></label>
      {!broadPlaces.length && <p className="help">Voeg hierboven eerst een brede plaats toe; exacte plaatsen zijn hier bewust niet beschikbaar.</p>}
      <label>Etappelabel <span className="optional">(optioneel)</span><input maxLength={120} value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Bijvoorbeeld: noordkust" /></label>
      <button type="submit">{draft.id ? "Etappe opslaan" : "Etappe toevoegen"}</button>
    </form>
    {stages.length > 0 && <div className="saved-moments manager-list">{stages.map((stage, index) => <article className="excerpt-row" key={stage.id}><div><strong>{stage.label ?? stage.place.label}</strong><span>{stage.place.label} · etappe {index + 1}</span></div><div className="button-row"><button className="secondary compact" type="button" disabled={index === 0} onClick={() => void moveStage(stage, -1).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De route-etappe kon niet worden verplaatst."))}>Omhoog</button><button className="secondary compact" type="button" disabled={index === stages.length - 1} onClick={() => void moveStage(stage, 1).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De route-etappe kon niet worden verplaatst."))}>Omlaag</button><button className="secondary compact" type="button" onClick={() => editStage(stage)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteStage(stage).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De route-etappe kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
  </section>;
}
