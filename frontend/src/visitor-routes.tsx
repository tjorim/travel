import { ApiError, apiFailure, errorMessage } from "./query/api";
import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
import { Preferences } from "./Preferences";
import { Button } from "@/ui/button";
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
import {
  forgetAllSharedTrips,
  forgetSharedTrip,
  readSavedSharedTrips,
  rememberSharedTrip,
  type SavedSharedTrip,
} from "./saved-shared-trips";

/** A long authored title would otherwise fill the first screen at display size with no room between lines. */
const LONG_TITLE_LENGTH = 40;
const LONG_TITLE_CLASS =
  "text-travel-title-long leading-travel-title-long tracking-travel-title-long min-[680px]:max-w-none";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection }
  | { kind: "unavailable" }
  | { kind: "error"; failure?: ApiError };

/** `summary` is Markdown; a card shows its one-line plain-text `summary_text` instead. */
type PublicTripCard = {
  slug: string;
  title: string | null;
  summary: string | null;
  summary_text?: string | null;
  dates?: ProjectionItem | null;
};
type IndexState =
  | { kind: "loading" }
  | { kind: "ready"; trips: PublicTripCard[] }
  | { kind: "error"; failure?: ApiError };

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
  useLocale();
  return (
    <footer className="mt-10.5">
      <a
        className="font-bold text-travel-forest underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
        href="/admin/"
        referrerPolicy="no-referrer"
      >
        {m.manage_trips()}
      </a>
    </footer>
  );
}

function TripIndex() {
  useLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<IndexState>({ kind: "loading" });
  const [storageFailed, setStorageFailed] = useState(false);
  const [savedTrips, setSavedTrips] = useState<SavedSharedTrip[]>(() => readSavedSharedTrips());

  const [validatedTrips, setValidatedTrips] = useState<Map<string, SavedSharedTrip | null>>(
    new Map(),
  );

  useEffect(() => {
    const controller = new AbortController();
    async function validate(trip: SavedSharedTrip) {
      try {
        const response = await fetch(`/api/shared/${encodeURIComponent(trip.token)}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 404 || response.status === 403) {
          const forgotten = forgetSharedTrip(trip.token);
          if (!forgotten) {
            setStorageFailed(true);
            setValidatedTrips((current) => new Map(current).set(trip.token, null));
          } else setSavedTrips((current) => current.filter((entry) => entry.token !== trip.token));
        } else if (response.ok) {
          const data: unknown = await response.json();
          if (!controller.signal.aborted && isProjection(data, "share")) {
            // Only show the current owner-selected fields, never a stale stored summary.
            setValidatedTrips((current) =>
              new Map(current).set(trip.token, {
                ...trip,
                title: data.title,
                summary: data.summary_text ?? data.summary,
              }),
            );
          }
        }
      } catch {
        // An offline or failed check keeps the shortcut stored but hides its content.
      }
    }
    for (const trip of readSavedSharedTrips()) void validate(trip);
    return () => controller.abort();
  }, []);

  function forgetAll() {
    const forgotten = forgetAllSharedTrips();
    setStorageFailed(!forgotten);
    if (forgotten) setSavedTrips([]);
  }

  function forget(token: string) {
    setStorageFailed(!forgetSharedTrip(token));
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
        if (!response.ok) throw await apiFailure(response, m.trips_error);
        const data: unknown = await response.json();
        if (!controller.signal.aborted)
          setState(isPublicTripCards(data) ? { kind: "ready", trips: data } : { kind: "error" });
      } catch (failure) {
        if (!controller.signal.aborted)
          setState({ kind: "error", ...(failure instanceof ApiError ? { failure } : {}) });
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);
  return (
    <main className="travel-shell w-travel-visitor-shell! max-w-travel-listing pt-6! min-[960px]:w-travel-owner-shell! [&_section]:mt-travel-section">
      <Preferences />
      <header className="border-b border-travel-divider pb-8 min-[680px]:pb-12">
        <p className="travel-eyebrow">Travel</p>
        <h1 className="max-w-travel-home-title!">{m.on_the_road()}</h1>
        <p className="max-w-travel-reading leading-relaxed text-travel-muted">{m.public_intro()}</p>
      </header>
      <section aria-label={m.public_trips()} aria-live="polite">
        {state.kind === "loading" && (
          <div className="travel-listing-state" role="status">
            <h2>{m.loading_trips()}</h2>
            <p>{m.wait()}</p>
          </div>
        )}
        {state.kind === "error" && (
          <div className="travel-listing-state" role="alert">
            <h2>{m.trips_error()}</h2>
            <p>
              {state.failure
                ? errorMessage(state.failure, m.retry_description)
                : m.retry_description()}
            </p>
            <Button type="button" onClick={() => setAttempt((current) => current + 1)}>
              {m.retry()}
            </Button>
          </div>
        )}
        {state.kind === "ready" && state.trips.length === 0 && (
          <div className="travel-listing-state" role="status">
            <h2>{m.no_public_trips()}</h2>
            <p>{m.come_back()}</p>
          </div>
        )}
        {state.kind === "ready" && state.trips.length > 0 && (
          <ul className="travel-trip-grid">
            {state.trips.map((trip) => (
              <li key={trip.slug} className="min-w-0">
                <Link className="travel-trip-card" to={`/trips/${encodeURIComponent(trip.slug)}`}>
                  <span className="mb-4 text-sm font-medium text-travel-muted">
                    {tripDates(trip.dates) ?? m.public_trip()}
                  </span>
                  <h2>{trip.title ?? m.published_trip()}</h2>
                  {(trip.summary_text ?? trip.summary) && (
                    <p className="line-clamp-4">{trip.summary_text ?? trip.summary}</p>
                  )}
                  <span className="mt-auto pt-6.25 font-extrabold text-travel-forest">
                    {m.view_trip()} <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {storageFailed && <p role="status">{m.visitor_storage_failed()}</p>}
      {savedTrips.length > 0 && (
        <section aria-label={m.saved_trips_label()}>
          <h2 className="text-travel-section tracking-tight">{m.saved_trips()}</h2>
          <Button className="secondary compact" type="button" onClick={forgetAll}>
            {m.forget_all_trips()}
          </Button>
          <p>{m.saved_trip_count({ count: savedTrips.length })}</p>
          <p className="max-w-travel-reading leading-relaxed text-travel-muted">
            {m.saved_notice()}
          </p>
          <ul className="travel-trip-grid">
            {savedTrips.flatMap((entry) => {
              const trip = validatedTrips.get(entry.token);
              if (trip === null)
                return [
                  <li key={entry.token} className="grid min-w-0 gap-2">
                    <p>{m.unavailable_trip()}</p>
                    <Button
                      className="secondary compact justify-self-start"
                      type="button"
                      onClick={() => forget(entry.token)}
                    >
                      {m.forget_trip()}
                    </Button>
                  </li>,
                ];
              return trip
                ? [
                    <li
                      key={trip.token}
                      className="grid min-w-0 gap-2 [&>button]:justify-self-start"
                    >
                      <Link
                        className="travel-trip-card"
                        to={`/share/${encodeURIComponent(trip.token)}`}
                      >
                        <span className="travel-eyebrow">{m.unlisted_trip()}</span>
                        <h2>{trip.title ?? m.shared_trip()}</h2>
                        {trip.summary && <p className="line-clamp-4">{trip.summary}</p>}
                        <span className="mt-auto pt-6.25 font-extrabold text-travel-forest">
                          {m.view_trip()} <span aria-hidden="true">→</span>
                        </span>
                      </Link>
                      <Button
                        className="secondary compact"
                        type="button"
                        onClick={() => forget(trip.token)}
                      >
                        {m.forget_trip()}
                      </Button>
                    </li>,
                  ]
                : [];
            })}
          </ul>
        </section>
      )}
      <OwnerLink />
    </main>
  );
}

function VisitorPage({ audience, identifier }: { audience: Audience; identifier: string }) {
  useLocale();
  const [attempt, setAttempt] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setStorageFailed(false);
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
          if (audience === "share") setStorageFailed(!forgetSharedTrip(identifier));
          setState({ kind: "unavailable" });
        } else if (!response.ok) {
          setState({ kind: "error", failure: await apiFailure(response, m.trip_error) });
        } else {
          const data: unknown = await response.json();
          if (!controller.signal.aborted) {
            if (isProjection(data, audience)) {
              if (audience === "share") setStorageFailed(!rememberSharedTrip(identifier, data));
              setState({ kind: "ready", projection: data });
            } else {
              setState({ kind: "error" });
            }
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setState({ kind: "error", ...(failure instanceof ApiError ? { failure } : {}) });
      }
    }
    void load();
    return () => controller.abort();
  }, [audience, identifier, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const title = m.shared_trip();
  return (
    <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
      <Preferences />
      <Link
        to="/trips"
        className="mb-6 inline-block text-sm text-travel-forest underline underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
      >
        {m.all_public_trips()}
      </Link>
      {state.kind !== "ready" && (
        <header>
          <p className="travel-eyebrow">Travel</p>
          <h1 className={title.length > LONG_TITLE_LENGTH ? LONG_TITLE_CLASS : undefined}>
            {title}
          </h1>
        </header>
      )}
      {state.kind === "loading" && (
        <section className="travel-card" role="status" aria-live="polite">
          <h2>{m.loading_trip()}</h2>
          <p>{m.wait()}</p>
        </section>
      )}
      {state.kind === "unavailable" && (
        <section className="travel-card" role="status">
          <h2>{m.unavailable_trip()}</h2>
          <p>{m.unavailable_description()}</p>
        </section>
      )}
      {state.kind === "error" && (
        <section className="travel-card" role="alert">
          <h2>{m.trip_error()}</h2>
          <p>
            {state.failure
              ? errorMessage(state.failure, m.retry_description)
              : m.retry_description()}
          </p>
          <Button type="button" onClick={retry}>
            {m.retry()}
          </Button>
        </section>
      )}
      {storageFailed && <p role="status">{m.visitor_storage_failed()}</p>}
      {state.kind === "ready" && (
        <ProjectionView projection={state.projection} audience={audience} identifier={identifier} />
      )}
      <OwnerLink />
    </main>
  );
}

function VisitorRoute({ audience }: { audience: Audience }) {
  useLocale();
  const { slug, token } = useParams({ strict: false });
  const identifier = audience === "public" ? slug : token;
  return identifier ? (
    <VisitorPage key={`${audience}:${identifier}`} audience={audience} identifier={identifier} />
  ) : (
    <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
      <Preferences />
      <section className="travel-card" role="status">
        <h1>{m.unavailable_trip()}</h1>
      </section>
    </main>
  );
}

const visitorRootRoute = createRootRoute({ component: Outlet });
const visitorIndexRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "/",
  component: TripIndex,
});
const visitorTripsRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "trips",
  component: TripIndex,
});
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
  component: () => {
    useLocale();
    return (
      <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
        <Preferences />
        <section className="travel-card" role="status">
          <h1>{m.page_unavailable()}</h1>
        </section>
      </main>
    );
  },
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
