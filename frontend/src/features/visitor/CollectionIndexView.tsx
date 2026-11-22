import { Link } from "@tanstack/react-router";
import type { CollectionIndex } from "@/api-types";
import { tripDates } from "@/components/projection/ProjectionView";
import { isContentLanguage } from "@/components/projection/visitor-language";
import type { ContentLanguage } from "@/i18n/content-language";
import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { LONG_TITLE_CLASS, LONG_TITLE_LENGTH } from "./VisitorPageChrome";

export function isCollectionIndex(value: unknown): value is CollectionIndex {
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

export function CollectionIndexView({
  index,
  token,
  language,
}: {
  index: CollectionIndex;
  token: string;
  /** The language the index's unmarked texts are in. */
  language: ContentLanguage | null;
}) {
  useLocale();
  const langOf = (marker: unknown) =>
    isContentLanguage(marker) ? marker : (language ?? undefined);
  return (
    <>
      <header className="border-b border-travel-divider pb-8 min-[680px]:pb-12">
        <p className="travel-eyebrow">Travel</p>
        <h1
          lang={index.title ? langOf(index.title_lang) : undefined}
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
                  <h2 lang={entry.title ? langOf(entry.title_lang) : undefined}>
                    {entry.title ?? m.shared_trip()}
                  </h2>
                  {entry.summary_text && (
                    <p className="line-clamp-4" lang={langOf(entry.summary_lang)}>
                      {entry.summary_text}
                    </p>
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
    </>
  );
}
