import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useEffect, useState } from "react";
import type { PublicTripCard } from "@/api-types";
import { VisitorTopBar } from "@/components/VisitorTopBar";
import { isProjection, tripDates } from "@/components/projection/ProjectionView";
import { isContentLanguage, withLanguage } from "@/components/projection/visitor-language";
import { Button } from "@/components/ui/button";
import type { ContentLanguage } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { ApiError, apiFailure, errorMessage } from "@/lib/api/api";
import { m } from "@/paraglide/messages.js";
import { isCollectionIndex } from "./CollectionIndexView";
import { OwnerLink } from "./VisitorPageChrome";
import {
  forgetAllSharedTrips,
  forgetSharedTrip,
  readSavedSharedTrips,
  type SavedSharedTrip,
} from "./saved-shared-trips";

/** The `lang` of a delivered text: its marker when it is in the other language, else the one that was asked for. */
const textLanguage = (marker: unknown, asked: ContentLanguage) =>
  isContentLanguage(marker) ? marker : asked;

function PublicCard({ trip }: { trip: PublicTripCard }) {
  const asked = useLocale();
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
            lang={cover.alt_text ? textLanguage(cover.alt_text_lang, asked) : undefined}
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
        <h2 lang={trip.title ? textLanguage(trip.title_lang, asked) : undefined}>
          {trip.title ?? m.published_trip()}
        </h2>
        {(trip.summary_text ?? trip.summary) && (
          <p className="line-clamp-4" lang={textLanguage(trip.summary_lang, asked)}>
            {trip.summary_text ?? trip.summary}
          </p>
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

export function TripIndex() {
  // The index has no trip of its own to follow: it asks for the language the interface is in.
  const locale = useLocale();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<IndexState>({ kind: "loading" });
  const [storageFailed, setStorageFailed] = useState(false);
  const [savedTrips, setSavedTrips] = useState<SavedSharedTrip[]>(() => readSavedSharedTrips());

  const [validatedTrips, setValidatedTrips] = useState<
    Map<
      string,
      {
        trip: SavedSharedTrip;
        collection: boolean;
        titleLang: ContentLanguage;
        summaryLang: ContentLanguage;
      } | null
    >
  >(new Map());

  useEffect(() => {
    const controller = new AbortController();
    async function validate(trip: SavedSharedTrip) {
      try {
        const response = await fetch(
          withLanguage(`/api/shared/${encodeURIComponent(trip.token)}`, locale),
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: controller.signal,
          },
        );
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
                titleLang: textLanguage(data.title_lang, locale),
                summaryLang: textLanguage(data.summary_lang, locale),
              }),
            );
          } else if (!controller.signal.aborted && isCollectionIndex(data)) {
            setValidatedTrips((current) =>
              new Map(current).set(trip.token, {
                trip: { ...trip, title: data.title, summary: null },
                collection: true,
                titleLang: textLanguage(data.title_lang, locale),
                summaryLang: locale,
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
  }, [locale]);

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
        const response = await fetch(withLanguage("/api/public/trips", locale), {
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
  }, [attempt, locale]);
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
                        <h2 lang={trip.title ? validated?.titleLang : undefined}>
                          {trip.title ??
                            (validated?.collection ? m.shared_trips() : m.shared_trip())}
                        </h2>
                        {trip.summary && (
                          <p className="line-clamp-4" lang={validated?.summaryLang}>
                            {trip.summary}
                          </p>
                        )}
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
