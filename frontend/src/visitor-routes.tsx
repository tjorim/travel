import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import { isProjection, ProjectionView, type Audience, type Projection } from "./ProjectionView";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection }
  | { kind: "unavailable" }
  | { kind: "error" };

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
          setState({ kind: "unavailable" });
        } else if (!response.ok) {
          setState({ kind: "error" });
        } else {
          const data: unknown = await response.json();
          if (!controller.signal.aborted) {
            setState(isProjection(data, audience) ? { kind: "ready", projection: data } : { kind: "error" });
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
      <Route path="/trips/:slug" element={<VisitorRoute audience="public" />} />
      <Route path="/share/:token" element={<VisitorRoute audience="share" />} />
      <Route path="*" element={<main className="shell visitor-shell"><section className="card" role="status"><h1>Pagina niet beschikbaar</h1></section></main>} />
    </Routes>
  );
}
