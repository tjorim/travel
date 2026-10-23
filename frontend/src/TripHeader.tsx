import { useState, type ElementType } from "react";
import { cn } from "cn";

import { useLocale } from "./locale";
import { Markdown } from "./Markdown";
import { m } from "./paraglide/messages.js";

/** A long authored title would otherwise fill the first screen at display size with no room between lines. */
const LONG_TITLE_LENGTH = 40;
const LONG_TITLE_CLASS =
  "text-travel-title-long leading-travel-title-long tracking-travel-title-long min-[680px]:max-w-none";

/** A cover the audience already receives. `url` is null while a preview still loads it. */
export type TripCover = {
  url: string | null;
  alt: string;
  caption: { html: string | null; text: string | null };
  focalX: number;
  focalY: number;
  width?: number;
  height?: number;
};

/**
 * The opening of a trip: its title, the dates and destinations the audience is authorized to see, and the
 * cover when it receives one. Without a cover, or when the image cannot load, the same text sits on a
 * quiet panel instead, so no audience ever sees an empty frame.
 */
export function TripHeader({
  title,
  eyebrow,
  level,
  dates,
  destinations,
  cover,
}: {
  title: string;
  eyebrow: string;
  level: "h1" | "h2";
  dates: string | null;
  destinations: string[];
  cover: TripCover | null;
}) {
  useLocale();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shown = cover && cover.url !== failedUrl ? cover : null;
  const Heading: ElementType = level;
  const facts = [dates, destinations.length > 0 ? destinations : null].some(Boolean);
  return (
    <header className="grid min-w-0 gap-5">
      {shown && (
        <figure className="m-0 min-w-0">
          {shown.url ? (
            <img
              className="block aspect-travel-cover max-h-travel-lightbox w-full rounded-travel-card bg-travel-tint object-cover min-[960px]:aspect-travel-hero"
              src={shown.url}
              alt={shown.alt}
              width={shown.width}
              height={shown.height}
              style={{ objectPosition: `${shown.focalX}% ${shown.focalY}%` }}
              decoding="async"
              fetchPriority="high"
              referrerPolicy="no-referrer"
              onError={() => setFailedUrl(shown.url)}
            />
          ) : (
            <div
              className="aspect-travel-cover w-full rounded-travel-card bg-travel-tint min-[960px]:aspect-travel-hero"
              aria-hidden="true"
            />
          )}
          <Markdown
            as="figcaption"
            className="mt-2 max-w-travel-reading text-sm leading-normal text-travel-muted"
            html={shown.caption.html}
            text={shown.caption.text}
          />
        </figure>
      )}
      <div
        className={cn(
          "grid min-w-0 gap-3",
          !shown &&
            "rounded-travel-card border-t-4 border-travel-warning-border bg-travel-surface p-travel-card-pad shadow-travel-card",
        )}
      >
        <p className="travel-eyebrow mb-0">{eyebrow}</p>
        <Heading
          className={cn(
            level === "h1"
              ? title.length > LONG_TITLE_LENGTH && LONG_TITLE_CLASS
              : "m-0 text-3xl leading-none tracking-tight",
            "wrap-anywhere",
          )}
        >
          {title}
        </Heading>
        {facts && (
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 leading-normal font-medium text-travel-muted">
            {dates && <span>{dates}</span>}
            {destinations.length > 0 && (
              <span>
                <span className="sr-only">{m.visitor_destinations()}: </span>
                {destinations.join(" · ")}
              </span>
            )}
          </p>
        )}
      </div>
    </header>
  );
}
