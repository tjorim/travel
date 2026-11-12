import { cn } from "cn";
import { ApiError, apiFailure, errorMessage } from "./query/api";
import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
import { VisitorTopBar } from "./VisitorTopBar";
import { Button } from "@/ui/button";
import { Collapsible } from "@/ui/collapsible";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "./ProjectionView";
import type { ProjectionDates } from "./projection-types";
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

/** One member of a collection link, only as far as its member scope allows. `id` is a collection-local path id. */
type CollectionEntry = {
  id: string;
  title: string | null;
  summary_text: string | null;
  dates: ProjectionDates | null;
  cover: string | null;
};
type CollectionIndex = {
  schema_version: "travel/collection@1";
  title: string | null;
  trips: CollectionEntry[];
};

function isCollectionIndex(value: unknown): value is CollectionIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const document = value as Record<string, unknown>;
  return (
    document.schema_version === "travel/collection@1" &&
    (document.title === null || typeof document.title === "string") &&
    Array.isArray(document.trips) &&
    document.trips.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        entry.id.length > 0 &&
        (entry.title == null || typeof entry.title === "string") &&
        (entry.summary_text == null || typeof entry.summary_text === "string") &&
        (entry.cover == null || typeof entry.cover === "string") &&
        (entry.dates == null || (typeof entry.dates === "object" && !Array.isArray(entry.dates))),
    )
  );
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection }
  | { kind: "collection"; index: CollectionIndex }
  | { kind: "unavailable" }
  | { kind: "error"; failure?: ApiError };

/** `summary` is Markdown; a card shows its one-line plain-text `summary_text` instead. */
type PublicTripCard = {
  cover?: {
    url: string;
    width: number | null;
    height: number | null;
    alt_text: string | null;
    focal_x: number | null;
    focal_y: number | null;
  } | null;
  slug: string;
  title: string | null;
  summary: string | null;
  summary_text?: string | null;
  dates?: ProjectionDates | null;
};
function PublicCard({ trip }: { trip: PublicTripCard }) {
  useLocale();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const cover = trip.cover && trip.cover.url !== failedUrl ? trip.cover : null;
  return (
    <Link
      className={cn("travel-trip-card", cover && "overflow-hidden border-t-0 p-0")}
      to={`/trips/${encodeURIComponent(trip.slug)}`}
    >
      {cover && (
        <div className="aspect-video w-full shrink-0 overflow-hidden bg-travel-hover">
          <img
            className="block size-full object-cover"
            src={cover.url}
            alt={cover.alt_text ?? ""}
            width={cover.width ?? undefined}
            height={cover.height ?? undefined}
            style={{ objectPosition: `${cover.focal_x ?? 50}% ${cover.focal_y ?? 50}%` }}
            decoding="async"
            loading="lazy"
            onError={() => setFailedUrl(cover.url)}
          />
        </div>
      )}
      <div className={cn("flex min-w-0 flex-1 flex-col", cover && "p-travel-card-pad")}>
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
      </div>
    </Link>
  );
}

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
        (card.cover == null ||
          (typeof card.cover === "object" &&
            typeof card.cover.url === "string" &&
            (card.cover.alt_text == null || typeof card.cover.alt_text === "string") &&
            [card.cover.width, card.cover.height, card.cover.focal_x, card.cover.focal_y].every(
              (value) => value == null || typeof value === "number",
            ))) &&
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

  const [validatedTrips, setValidatedTrips] = useState<
    Map<string, { trip: SavedSharedTrip; collection: boolean } | null>
  >(new Map());

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
                trip: { ...trip, title: data.title, summary: data.summary_text ?? data.summary },
                collection: false,
              }),
            );
          } else if (!controller.signal.aborted && isCollectionIndex(data)) {
            setValidatedTrips((current) =>
              new Map(current).set(trip.token, {
                trip: { ...trip, title: data.title, summary: null },
                collection: true,
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
      <VisitorTopBar />
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
                <PublicCard trip={trip} />
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
              const validated = validatedTrips.get(entry.token);
              const trip = validated?.trip;
              if (validated === null)
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
                        <span className="travel-eyebrow">
                          {validated?.collection ? m.unlisted_collection() : m.unlisted_trip()}
                        </span>
                        <h2>
                          {trip.title ??
                            (validated?.collection ? m.shared_trips() : m.shared_trip())}
                        </h2>
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

function CollectionIndexView({ index, token }: { index: CollectionIndex; token: string }) {
  useLocale();
  return (
    <>
      <header className="border-b border-travel-divider pb-8 min-[680px]:pb-12">
        <p className="travel-eyebrow">Travel</p>
        <h1
          className={
            (index.title?.length ?? 0) > LONG_TITLE_LENGTH
              ? LONG_TITLE_CLASS
              : "max-w-travel-home-title!"
          }
        >
          {index.title ?? m.shared_trips()}
        </h1>
        <p className="max-w-travel-reading leading-relaxed text-travel-muted">
          {m.collection_intro()}
        </p>
      </header>
      <section aria-label={m.collection_trips_label()} className="mt-travel-section">
        {index.trips.length === 0 ? (
          <div className="travel-listing-state" role="status">
            <h2>{m.collection_empty()}</h2>
            <p>{m.collection_empty_description()}</p>
          </div>
        ) : (
          <ul className="travel-trip-grid">
            {index.trips.map((entry) => (
              <li key={entry.id} className="min-w-0">
                <Link
                  className="travel-trip-card"
                  to={`/share/${encodeURIComponent(token)}/trips/${encodeURIComponent(entry.id)}`}
                >
                  {entry.cover && (
                    <img
                      className="mb-4 aspect-video w-full rounded-travel-control object-cover"
                      src={`/api/shared/${encodeURIComponent(token)}/trips/${encodeURIComponent(entry.id)}/files/${encodeURIComponent(entry.cover)}`}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  <span className="mb-4 text-sm font-medium text-travel-muted">
                    {tripDates(entry.dates) ?? m.unlisted_trip()}
                  </span>
                  <h2>{entry.title ?? m.shared_trip()}</h2>
                  {entry.summary_text && <p className="line-clamp-4">{entry.summary_text}</p>}
                  <span className="mt-auto pt-6.25 font-extrabold text-travel-forest">
                    {m.view_trip()} <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function VisitorPage({
  audience,
  identifier,
  memberId,
}: {
  audience: Audience;
  identifier: string;
  /** A trip inside a collection link; `identifier` is then the collection's token. */
  memberId?: string;
}) {
  useLocale();
  const [attempt, setAttempt] = useState(0);
  const [storageFailed, setStorageFailed] = useState(false);
  const [saved, setSaved] = useState<"saved" | "forgotten" | null>(null);
  const forgottenNotice = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // Forgetting removes the focused button: move focus to the confirmation.
    if (saved === "forgotten") forgottenNotice.current?.focus();
  }, [saved]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setStorageFailed(false);
    setSaved(null);
    const path =
      audience === "public"
        ? `/api/public/trips/${encodeURIComponent(identifier)}`
        : memberId
          ? `/api/shared/${encodeURIComponent(identifier)}/trips/${encodeURIComponent(memberId)}`
          : `/api/shared/${encodeURIComponent(identifier)}`;
    let loading = false;
    async function load(refresh = false) {
      if (loading) return;
      loading = true;
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
        if (controller.signal.aborted) return;
        if (response.status === 404 || response.status === 403) {
          // A missing member says nothing about the collection, which may still be valid.
          if (audience === "share" && !memberId) setStorageFailed(!forgetSharedTrip(identifier));
          setSaved(null);
          setState({ kind: "unavailable" });
        } else if (!response.ok) {
          setState({ kind: "error", failure: await apiFailure(response, m.trip_error) });
        } else {
          const data: unknown = await response.json();
          if (!controller.signal.aborted) {
            if (audience === "share" && !memberId && isCollectionIndex(data)) {
              if (!refresh) {
                const remembered = rememberSharedTrip(identifier, { title: data.title });
                setStorageFailed(!remembered);
                setSaved(remembered ? "saved" : null);
              }
              setState({ kind: "collection", index: data });
            } else if (isProjection(data, audience)) {
              if (!refresh && audience === "share" && !memberId) {
                const remembered = rememberSharedTrip(identifier, data);
                setStorageFailed(!remembered);
                setSaved(remembered ? "saved" : null);
              }
              setState({ kind: "ready", projection: data });
            } else {
              setState({ kind: "error" });
            }
          }
        }
      } catch (failure) {
        if (!controller.signal.aborted)
          setState({ kind: "error", ...(failure instanceof ApiError ? { failure } : {}) });
      } finally {
        loading = false;
      }
    }
    void load();
    // Re-evaluate delayed cutoffs and scope revocation without new ingestion.
    const timer = window.setInterval(() => void load(true), 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [audience, identifier, memberId, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const title = m.shared_trip();
  return (
    <main
      data-visitor-print=""
      className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!"
    >
      {state.kind === "ready" && state.projection.updates.length > 0 && (
        <a
          href="#story"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-travel-control focus:bg-travel-surface focus:px-4 focus:py-3 focus:font-bold focus:text-travel-forest focus:underline focus:outline-3 focus:outline-travel-focus"
        >
          {m.visitor_skip_to_story()}
        </a>
      )}
      <VisitorTopBar
        detail
        back={
          memberId
            ? {
                href: `/share/${encodeURIComponent(identifier)}`,
                label: m.visitor_back_to_collection(),
              }
            : undefined
        }
      />
      {(state.kind === "ready" || state.kind === "collection") && saved === "saved" && (
        <section
          aria-label={m.share_saved_title()}
          className="mb-3 min-w-0 rounded-travel-control border border-travel-border px-3 py-0.5 print:hidden"
        >
          <Collapsible.Root>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="m-0 text-sm">{m.share_saved_title()}</h2>
              <Collapsible.Trigger className="rounded-travel-control bg-transparent py-1 text-sm font-bold text-travel-forest underline underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus">
                {m.share_saved_details()}
              </Collapsible.Trigger>
              <Button
                className="secondary compact ml-auto"
                type="button"
                onClick={() => {
                  const forgotten = forgetSharedTrip(identifier);
                  setStorageFailed(!forgotten);
                  if (forgotten) setSaved("forgotten");
                }}
              >
                {m.share_forget_link()}
              </Button>
            </div>
            <Collapsible.Panel>
              <p className="m-0 max-w-travel-reading pb-2 leading-relaxed text-travel-muted">
                {m.share_saved_notice()}
              </p>
            </Collapsible.Panel>
          </Collapsible.Root>
        </section>
      )}
      {state.kind !== "ready" && state.kind !== "collection" && (
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
      {(state.kind === "ready" || state.kind === "collection") && saved === "forgotten" && (
        <p role="status" tabIndex={-1} ref={forgottenNotice}>
          {m.share_forgotten()}
        </p>
      )}
      {state.kind === "collection" && (
        <CollectionIndexView index={state.index} token={identifier} />
      )}
      {state.kind === "ready" && (
        <ProjectionView
          projection={state.projection}
          audience={audience}
          identifier={identifier}
          apiBase={
            memberId
              ? `/api/shared/${encodeURIComponent(identifier)}/trips/${encodeURIComponent(memberId)}`
              : undefined
          }
        />
      )}
      <OwnerLink />
    </main>
  );
}

function VisitorRoute({ audience }: { audience: Audience }) {
  useLocale();
  const { slug, token, memberId } = useParams({ strict: false });
  const identifier = audience === "public" ? slug : token;
  return identifier ? (
    <VisitorPage
      key={`${audience}:${identifier}:${memberId ?? ""}`}
      audience={audience}
      identifier={identifier}
      memberId={audience === "share" ? memberId : undefined}
    />
  ) : (
    <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
      <VisitorTopBar />
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
const visitorShareTripRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "share/$token/trips/$memberId",
  component: () => <VisitorRoute audience="share" />,
});
const visitorNotFoundRoute = createRoute({
  getParentRoute: () => visitorRootRoute,
  path: "$",
  component: () => {
    useLocale();
    return (
      <main className="travel-shell w-travel-visitor-shell! pt-6! min-[960px]:w-travel-owner-shell!">
        <VisitorTopBar />
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
  visitorShareTripRoute,
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
