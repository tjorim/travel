import { Button } from "@base-ui/react/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import {
  isProjection,
  ProjectionView,
  tripDates,
  type Audience,
  type Projection,
  type ProjectionItem,
} from "./ProjectionView";
import { forgetSharedTrip, readSavedSharedTrips, rememberSharedTrip, type SavedSharedTrip } from "./saved-shared-trips";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection }
  | { kind: "unavailable" }
  | { kind: "error" };

/** `summary` is Markdown; a card shows its one-line plain-text `summary_text` instead. */
type PublicTripCard = {
  slug: string;
  title: string | null;
  summary: string | null;
  summary_text?: string | null;
  dates?: ProjectionItem | null;
};
type IndexState = { kind: "loading" } | { kind: "ready"; trips: PublicTripCard[] } | { kind: "error" };

function isPublicTripCards(value: unknown): value is PublicTripCard[] {
  return (
    Array.isArray(value) &&
    value.every(
      (card) =>
        card !== null &&
        typeof card === "object" &&
        typeof card.slug === "string" &&
        card.slug.length > 0 &&
        (card.title === null || typeof card.title === "string") &&
        (card.summary === null || typeof card.summary === "string") &&
        (card.summary_text == null || typeof card.summary_text === "string") &&
        (card.dates == null || (typeof card.dates === "object" && !Array.isArray(card.dates))),
    )
  );
}

function OwnerLink() {
  return (
    <footer className="mt-10.5">
      <a
        className="font-bold text-travel-forest underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
        href="/admin/"
        referrerPolicy="no-referrer"
      >
        Mijn reizen beheren
      </a>
    </footer>
  );
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
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Listing unavailable");
        const data: unknown = await response.json();
        if (!controller.signal.aborted)
          setState(isPublicTripCards(data) ? { kind: "ready", trips: data } : { kind: "error" });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return (
    <main className="travel-shell w-travel-index-shell! [&_h1]:max-w-none [&_section]:mt-10">
      <header>
        <p className="travel-eyebrow">Travel</p>
        <h1>Op reis</h1>
        <p className="max-w-145 leading-relaxed text-travel-muted">Ontdek de reizen die hier publiek gedeeld worden.</p>
      </header>
      <section aria-label="Publieke reizen" aria-live="polite">
        {state.kind === "loading" && (
          <div className="travel-card" role="status">
            <h2>Reizen laden</h2>
            <p>Een ogenblik geduld.</p>
          </div>
        )}
        {state.kind === "error" && (
          <div className="travel-card" role="alert">
            <h2>Reizen kunnen niet worden geladen</h2>
            <p>Probeer het opnieuw wanneer de verbinding werkt.</p>
            <Button type="button" onClick={() => setAttempt((current) => current + 1)}>
              Opnieuw proberen
            </Button>
          </div>
        )}
        {state.kind === "ready" && state.trips.length === 0 && (
          <div className="travel-card" role="status">
            <h2>Nog geen publieke reizen</h2>
            <p>Kom later terug om nieuwe reizen te ontdekken.</p>
          </div>
        )}
        {state.kind === "ready" && state.trips.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-1 gap-4.5 p-0 min-[620px]:grid-cols-2 min-[960px]:grid-cols-3">
            {state.trips.map((trip) => (
              <li key={trip.slug}>
                <Link
                  className="travel-card flex h-full flex-col text-inherit no-underline transition-all hover:-translate-y-0.75 hover:shadow-xl focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus [&_h2]:mb-3 [&_h2]:text-2xl [&_p]:wrap-anywhere"
                  to={`/trips/${encodeURIComponent(trip.slug)}`}
                >
                  <span className="travel-eyebrow">{tripDates(trip.dates) ?? "Publieke reis"}</span>
                  <h2>{trip.title ?? "Gepubliceerde reis"}</h2>
                  {(trip.summary_text ?? trip.summary) && <p>{trip.summary_text ?? trip.summary}</p>}
                  <span className="mt-auto pt-6.25 font-extrabold text-travel-forest">
                    Bekijk reis <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {savedTrips.length > 0 && (
        <section aria-label="Op dit apparaat bewaarde verborgen reizen">
          <h2>Eerder bekeken verborgen reizen</h2>
          <p className="max-w-145 leading-relaxed text-travel-muted">
            Alleen in deze browser bewaard. Wie dit apparaat gebruikt, kan deze links openen.
          </p>
          <ul className="m-0 grid list-none grid-cols-1 gap-4.5 p-0 min-[620px]:grid-cols-2 min-[960px]:grid-cols-3">
            {savedTrips.map((trip) => (
              <li key={trip.token} className="grid gap-2 [&>button]:justify-self-start">
                <Link
                  className="travel-card flex h-full flex-col text-inherit no-underline transition-all hover:-translate-y-0.75 hover:shadow-xl focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus [&_h2]:mb-3 [&_h2]:text-2xl [&_p]:wrap-anywhere"
                  to={`/share/${encodeURIComponent(trip.token)}`}
                >
                  <span className="travel-eyebrow">Verborgen reis</span>
                  <h2>{trip.title ?? "Gedeelde reis"}</h2>
                  {trip.summary && <p>{trip.summary}</p>}
                  <span className="mt-auto pt-6.25 font-extrabold text-travel-forest">
                    Bekijk reis <span aria-hidden="true">→</span>
                  </span>
                </Link>
                <Button className="secondary compact" type="button" onClick={() => forget(trip.token)}>
                  Verwijderen van dit apparaat
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <OwnerLink />
    </main>
  );
}

function VisitorPage({ audience, identifier }: { audience: Audience; identifier: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    const path =
      audience === "public"
        ? `/api/public/trips/${encodeURIComponent(identifier)}`
        : `/api/shared/${encodeURIComponent(identifier)}`;
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
    <main className="travel-shell">
      <header>
        <p className="travel-eyebrow">Travel</p>
        <h1>{state.kind === "ready" && state.projection.title ? state.projection.title : "Gedeelde reis"}</h1>
      </header>
      {state.kind === "loading" && (
        <section className="travel-card" role="status" aria-live="polite">
          <h2>Reis laden</h2>
          <p>Een ogenblik geduld.</p>
        </section>
      )}
      {state.kind === "unavailable" && (
        <section className="travel-card" role="status">
          <h2>Reis niet beschikbaar</h2>
          <p>Deze reis is niet beschikbaar.</p>
        </section>
      )}
      {state.kind === "error" && (
        <section className="travel-card" role="alert">
          <h2>Reis kan niet worden geladen</h2>
          <p>Probeer het opnieuw wanneer de verbinding werkt.</p>
          <Button type="button" onClick={retry}>
            Opnieuw proberen
          </Button>
        </section>
      )}
      {state.kind === "ready" && (
        <ProjectionView projection={state.projection} audience={audience} identifier={identifier} />
      )}
      <OwnerLink />
    </main>
  );
}

function VisitorRoute({ audience }: { audience: Audience }) {
  const { slug, token } = useParams({ strict: false });
  const identifier = audience === "public" ? slug : token;
  return identifier ? (
    <VisitorPage key={`${audience}:${identifier}`} audience={audience} identifier={identifier} />
  ) : (
    <main className="travel-shell">
      <section className="travel-card" role="status">
        <h1>Reis niet beschikbaar</h1>
      </section>
    </main>
  );
}

const visitorRootRoute = createRootRoute({ component: Outlet });
const visitorIndexRoute = createRoute({ getParentRoute: () => visitorRootRoute, path: "/", component: TripIndex });
const visitorTripsRoute = createRoute({ getParentRoute: () => visitorRootRoute, path: "trips", component: TripIndex });
const visitorTripRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "trips/$slug",
  component: () => <VisitorRoute audience="public" />,
});
const visitorShareRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "share/$token",
  component: () => <VisitorRoute audience="share" />,
});
const visitorNotFoundRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "$",
  component: () => (
    <main className="travel-shell">
      <section className="travel-card" role="status">
        <h1>Pagina niet beschikbaar</h1>
      </section>
    </main>
  ),
});

export const visitorRouteTree = visitorRootRoute.addChildren([
  visitorIndexRoute,
  visitorTripsRoute,
  visitorTripRoute,
  visitorShareRoute,
  visitorNotFoundRoute,
]);

export function createVisitorRouter(initialEntries?: string[]) {
  return createRouter({
    routeTree: visitorRouteTree,
    history: initialEntries ? createMemoryHistory({ initialEntries }) : undefined,
  });
}

export function VisitorRoutes({ initialEntries }: { initialEntries?: string[] } = {}) {
  const router = useMemo(() => createVisitorRouter(initialEntries), [initialEntries]);
  return <RouterProvider router={router} />;
}
