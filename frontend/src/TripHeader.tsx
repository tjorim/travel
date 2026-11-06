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
 * cover when it receives one. With a cover, the title sits over a full-width hero (a compact band on a phone that
 * scrolls away) on a scrim that keeps the text readable on any photo. Without a cover, or when the image cannot
 * load, the text remains in place without an empty image frame.
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
  const long = title.length > LONG_TITLE_LENGTH;
  const text = (
    <>
      <p className="sr-only">{eyebrow}</p>
      <Heading
        className={cn(
          level === "h1" ? long && LONG_TITLE_CLASS : "tracking-tight",
          "m-0! max-w-none! leading-tight! wrap-anywhere",
          shown
            ? cn(
                "text-travel-hero-ink text-shadow-travel-hero",
                long ? "text-2xl! min-[960px]:text-4xl!" : "text-3xl! min-[960px]:text-5xl!",
              )
            : "text-2xl! min-[960px]:text-3xl!",
        )}
      >
        {title}
      </Heading>
      {facts && (
        <p
          className={cn(
            "m-0 flex flex-wrap gap-x-4 gap-y-1 leading-normal font-medium",
            shown ? "text-sm text-travel-hero-ink min-[680px]:text-base" : "text-travel-muted",
          )}
        >
          {dates && <span>{dates}</span>}
          {destinations.length > 0 && (
            <span>
              <span className="sr-only">{m.visitor_destinations()}: </span>
              {destinations.join(" · ")}
            </span>
          )}
        </p>
      )}
    </>
  );
  if (!shown) return <header className="grid min-w-0 gap-3">{text}</header>;
  return (
    <header className="grid min-w-0 grid-cols-1" data-hero="">
      {/* First in the document so the title precedes the photo; the photo is stacked behind it in the same cell. */}
      <div className="relative z-10 col-start-1 row-start-1 flex min-h-travel-hero min-w-0 items-end min-[960px]:min-h-travel-hero-wide">
        <div
          data-hero-text=""
          className="travel-hero-scrim grid w-full min-w-0 gap-2 rounded-b-travel-card px-4 pt-14 pb-4 text-travel-hero-ink min-[680px]:px-6 min-[680px]:pb-6 min-[960px]:px-8 min-[960px]:pb-8"
        >
          {text}
        </div>
      </div>
      <figure className="col-start-1 row-span-2 row-start-1 m-0 grid min-w-0 grid-rows-subgrid">
        <div className="relative min-h-0 overflow-hidden rounded-travel-card bg-travel-forest">
          {shown.url && (
            <img
              data-hero-image=""
              className="absolute inset-0 block size-full object-cover"
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
          )}
        </div>
        <Markdown
          as="figcaption"
          className="mt-2 max-w-travel-reading text-sm leading-normal text-travel-muted"
          html={shown.caption.html}
          text={shown.caption.text}
        />
      </figure>
    </header>
  );
}
