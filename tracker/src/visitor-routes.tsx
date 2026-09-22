import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";

type Audience = "public" | "share";

type Projection = {
  schema_version: string;
  title: string | null;
  summary: string | null;
  route_stages: unknown[];
  places: unknown[];
  moments: unknown[];
  stays: unknown[];
  media: unknown[];
  documents: unknown[];
  route: unknown[];
  navigation: unknown[];
};

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection }
  | { kind: "unavailable" }
  | { kind: "error" };

const contentKeys = ["route_stages", "places", "moments", "stays", "media", "documents", "route"] as const;

function isProjection(value: unknown, audience: Audience): value is Projection {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  return document.schema_version === (audience === "public" ? "travel/public-trip@1" : "travel/unlisted-trip@1")
    && (document.title === null || typeof document.title === "string")
    && (document.summary === null || typeof document.summary === "string")
    && [...contentKeys, "navigation"].every((key) => Array.isArray(document[key]));
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
  const itemCount = state.kind === "ready" ? contentKeys.reduce((count, key) => count + state.projection[key].length, 0) : 0;
  const isEmpty = state.kind === "ready" && !state.projection.title && !state.projection.summary && itemCount === 0;

  return (
    <main className="shell visitor-shell">
      <header>
        <p className="eyebrow">Travel</p>
        <h1>{state.kind === "ready" && state.projection.title ? state.projection.title : "Gedeelde reis"}</h1>
      </header>
      {state.kind === "loading" && <section className="card" role="status" aria-live="polite"><h2>Reis laden</h2><p>Een ogenblik geduld.</p></section>}
      {state.kind === "unavailable" && <section className="card" role="status"><h2>Reis niet beschikbaar</h2><p>Deze reis is niet beschikbaar.</p></section>}
      {state.kind === "error" && <section className="card" role="alert"><h2>Reis kan niet worden geladen</h2><p>Probeer het opnieuw wanneer de verbinding werkt.</p><button type="button" onClick={retry}>Opnieuw proberen</button></section>}
      {state.kind === "ready" && (isEmpty
        ? <section className="card" role="status"><h2>Nog geen gedeelde inhoud</h2><p>Voor deze reis is nog geen inhoud geselecteerd.</p></section>
        : <section className="card"><h2>Reisoverzicht</h2>{state.projection.summary && <p>{state.projection.summary}</p>}{itemCount > 0 && <p>{itemCount} gedeelde onderdelen.</p>}</section>)}
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
