import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { isProjection, ProjectionView, tripDates, type Audience, type Projection, type ProjectionItem } from "./ProjectionView";
import { forgetSharedTrip, readSavedSharedTrips, rememberSharedTrip, type SavedSharedTrip } from "./saved-shared-trips";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection }
  | { kind: "unavailable" }
  | { kind: "error" };

type PublicTripCard = { slug: string; title: string | null; summary: string | null; dates?: ProjectionItem | null };
type IndexState = { kind: "loading" } | { kind: "ready"; trips: PublicTripCard[] } | { kind: "error" };

function isPublicTripCards(value: unknown): value is PublicTripCard[] {
  return Array.isArray(value) && value.every((card) => card !== null && typeof card === "object"
    && typeof card.slug === "string" && card.slug.length > 0
    && (card.title === null || typeof card.title === "string")
    && (card.summary === null || typeof card.summary === "string")
    && (card.dates == null || (typeof card.dates === "object" && !Array.isArray(card.dates))));
}

function TripIndex() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<IndexState>({ kind: "loading" });
  const [savedTrips, setSavedTrips] = useState<SavedSharedTrip[]>(() => readSavedSharedTrips());

  function forget(token: string) {
    forgetSharedTrip(token);
    setSavedTrips(readSavedSharedTrips());
  }
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    async function load() {
      try {
        const response = await fetch("/api/public/trips", {
          headers: { Accept: "application/json" }, cache: "no-store", credentials: "omit",
          redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Listing unavailable");
        const data: unknown = await response.json();
        if (!controller.signal.aborted) setState(isPublicTripCards(data) ? { kind: "ready", trips: data } : { kind: "error" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return <main className="shell visitor-shell trip-index">
    <header><p className="eyebrow">Travel</p><h1>Op reis</h1><p className="lede">Ontdek de reizen die hier publiek gedeeld worden.</p></header>
    <section aria-label="Publieke reizen" aria-live="polite">
      {state.kind === "loading" && <div className="card" role="status"><h2>Reizen laden</h2><p>Een ogenblik geduld.</p></div>}
      {state.kind === "error" && <div className="card" role="alert"><h2>Reizen kunnen niet worden geladen</h2><p>Probeer het opnieuw wanneer de verbinding werkt.</p><button type="button" onClick={() => setAttempt((current) => current + 1)}>Opnieuw proberen</button></div>}
      {state.kind === "ready" && state.trips.length === 0 && <div className="card" role="status"><h2>Nog geen publieke reizen</h2><p>Kom later terug om nieuwe reizen te ontdekken.</p></div>}
      {state.kind === "ready" && state.trips.length > 0 && <ul className="trip-cards">{state.trips.map((trip) => <li key={trip.slug}><Link className="trip-card card" to={`/trips/${encodeURIComponent(trip.slug)}`}><span className="eyebrow">{tripDates(trip.dates) ?? "Publieke reis"}</span><h2>{trip.title ?? "Gepubliceerde reis"}</h2>{trip.summary && <p>{trip.summary}</p>}<span className="trip-card-link">Bekijk reis <span aria-hidden="true">→</span></span></Link></li>)}</ul>}
    </section>
    {savedTrips.length > 0 && <section aria-label="Op dit apparaat bewaarde verborgen reizen"><h2>Eerder bekeken verborgen reizen</h2><p className="lede">Alleen in deze browser bewaard. Wie dit apparaat gebruikt, kan deze links openen.</p><ul className="trip-cards">{savedTrips.map((trip) => <li key={trip.token} className="saved-trip"><Link className="trip-card card" to={`/share/${encodeURIComponent(trip.token)}`}><span className="eyebrow">Verborgen reis</span><h2>{trip.title ?? "Gedeelde reis"}</h2>{trip.summary && <p>{trip.summary}</p>}<span className="trip-card-link">Bekijk reis <span aria-hidden="true">→</span></span></Link><button className="secondary compact" type="button" onClick={() => forget(trip.token)}>Verwijderen van dit apparaat</button></li>)}</ul></section>}
    <footer className="trip-index-footer"><a href="/admin/">Mijn reizen beheren</a></footer>
  </main>;
}

function VisitorPage({ audience, identifier }: { audience: Audience; identifier: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    const path = audience === "public" ? `/api/public/trips/${encodeURIComponent(identifier)}` : `/api/shared/${encodeURIComponent(identifier)}`;
    async function load() {
      try {
        const response = await fetch(path, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (response.status === 404 || response.status === 403) {
          if (audience === "share") forgetSharedTrip(identifier);
          setState({ kind: "unavailable" });
        } else if (!response.ok) {
          setState({ kind: "error" });
        } else {
          const data: unknown = await response.json();
          if (!controller.signal.aborted) {
            if (isProjection(data, audience)) {
              if (audience === "share") rememberSharedTrip(identifier, data);
              setState({ kind: "ready", projection: data });
            } else {
              setState({ kind: "error" });
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [audience, identifier, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return (
    <main className="shell visitor-shell">
      <header>
        <p className="eyebrow">Travel</p>
        <h1>{state.kind === "ready" && state.projection.title ? state.projection.title : "Gedeelde reis"}</h1>
      </header>
      {state.kind === "loading" && <section className="card" role="status" aria-live="polite"><h2>Reis laden</h2><p>Een ogenblik geduld.</p></section>}
      {state.kind === "unavailable" && <section className="card" role="status"><h2>Reis niet beschikbaar</h2><p>Deze reis is niet beschikbaar.</p></section>}
      {state.kind === "error" && <section className="card" role="alert"><h2>Reis kan niet worden geladen</h2><p>Probeer het opnieuw wanneer de verbinding werkt.</p><button type="button" onClick={retry}>Opnieuw proberen</button></section>}
      {state.kind === "ready" && <ProjectionView projection={state.projection} audience={audience} identifier={identifier} />}
    </main>
  );
}

function VisitorRoute({ audience }: { audience: Audience }) {
  const { slug, token } = useParams();
  const identifier = audience === "public" ? slug : token;
  return identifier
    ? <VisitorPage key={`${audience}:${identifier}`} audience={audience} identifier={identifier} />
    : <main className="shell visitor-shell"><section className="card" role="status"><h1>Reis niet beschikbaar</h1></section></main>;
}

export function VisitorRoutes() {
  return (
    <Routes>
      <Route path="/" element={<TripIndex />} />
      <Route path="/trips" element={<TripIndex />} />
      <Route path="/trips/:slug" element={<VisitorRoute audience="public" />} />
      <Route path="/share/:token" element={<VisitorRoute audience="share" />} />
      <Route path="*" element={<main className="shell visitor-shell"><section className="card" role="status"><h1>Pagina niet beschikbaar</h1></section></main>} />
    </Routes>
  );
}
