import type { Projection, ProjectionItem, ProjectionMedia, ProjectionUpdate } from "@/api-types";
import { Markdown } from "@/components/Markdown";
import { Collapsible } from "@/components/ui/collapsible";
import { useLocale } from "@/i18n/locale";
import { dayjs } from "@/lib/dayjs";
import { m } from "@/paraglide/messages.js";
import { cn } from "cn";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PlaceText } from "./PlaceText";
import { Gallery } from "./ProjectionGallery";
import {
  place,
  precision,
  routeHeading,
  storyDate,
  text,
  transportKinds,
  transportPlace,
  transportStatuses,
  transportTime,
  tripDates,
  visitTimes,
} from "./projectionFormatting";
import type { UpdateContext } from "./visitor-context";
import { Authored, useTextLang } from "./visitor-language";

/** Whole days between two updates dated to the day, else null: the story's "3 days later" connector. */
function daysLater(previous: ProjectionUpdate | undefined, item: ProjectionUpdate): number | null {
  const [from, to] = [previous, item].map((entry) => {
    // `storyDate` rejects an impossible date and a month or year date, so only a valid day gets a gap.
    const value =
      entry && storyDate(entry.story_date, entry.date_precision) ? text(entry.story_date) : null;
    return value?.length === 10 ? dayjs.utc(value) : null;
  });
  if (!from?.isValid() || !to?.isValid()) return null;
  const days = to.diff(from, "day");
  return days > 0 ? days : null;
}

/**
 * Reports the update the reader has reached: the last one whose top has passed a line a third of the way down the
 * window. Nothing is observed when the map is not beside the story, so a phone does no extra work.
 */
function useActiveUpdate(
  list: React.RefObject<HTMLOListElement | null>,
  enabled: boolean,
  onActive: (id: string | null) => void,
) {
  const report = useRef(onActive);
  report.current = onActive;
  const [wide, setWide] = useState(
    () => window.matchMedia?.("(min-width: 1100px)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(min-width: 1100px)");
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const items = list.current ? Array.from(list.current.children) : [];
    // Narrower than the map-beside-story layout, or without it, nothing is followed: drop any update left over.
    if (!enabled || !wide) {
      report.current(null);
      return;
    }
    if (!items.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entering = entries.filter((entry) => entry.isIntersecting);
        if (entering.length) report.current(entering[entering.length - 1].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const item of items) observer.observe(item);
    return () => observer.disconnect();
  }, [enabled, wide, list]);
}

/** Compact approved visits, stays and routes of the same area and day, shown with the update they belong to. */
function UpdateContextBlock({
  context,
  navigationLink,
}: {
  context: UpdateContext;
  navigationLink?: (item: ProjectionItem) => ReactNode;
}) {
  useLocale();
  const entries = [
    ...context.stays.map((item) => ({
      item,
      anchor: "stay",
      kind: m.visitor_stay(),
      title: text(item.title) ?? m.visitor_stay(),
      lines: [tripDates(item)],
    })),
    ...context.visits.map((item) => ({
      item,
      anchor: "visit",
      kind: m.visitor_visit(),
      title: text(item.title) ?? m.visitor_visit(),
      lines: [tripDates(item), visitTimes(item)],
    })),
    ...context.routes.map((item) => {
      const departure = transportPlace(item.departure);
      const arrival = transportPlace(item.arrival);
      const mode = transportKinds()[text(item.mode) ?? ""];
      const status = transportStatuses()[text(item.status) ?? ""];
      return {
        item,
        anchor: "route",
        kind: m.visitor_route(),
        title: routeHeading(item),
        lines: [
          departure || arrival
            ? `${departure ?? m.visitor_departure_unknown()} → ${arrival ?? m.visitor_arrival_unknown()}`
            : null,
          [mode, status].filter(Boolean).join(" · ") || null,
          [transportTime(item, "departure"), transportTime(item, "arrival")].some(Boolean)
            ? `${transportTime(item, "departure") ?? m.visitor_departure_time_unknown()} → ${transportTime(item, "arrival") ?? m.visitor_arrival_time_unknown()}`
            : storyDate(item.departs_on, item.date_precision),
        ],
      };
    }),
  ];
  if (!entries.length) return null;
  return (
    <section
      data-update-context=""
      aria-label={m.visitor_update_context()}
      className="rounded-travel-media border border-travel-divider bg-travel-tint px-3.5 py-3 text-sm"
    >
      <p className="m-0 mb-2 text-xs font-bold tracking-travel-eyebrow text-travel-muted uppercase">
        {m.visitor_update_context()}
      </p>
      <ul className="m-0 grid list-none gap-2.5 p-0">
        {entries.map(({ item, anchor, kind, title, lines }) => (
          <li
            key={`${anchor}-${item.id}`}
            id={`${anchor}-${item.id}`}
            tabIndex={-1}
            className="min-w-0 scroll-mt-6 wrap-anywhere focus:outline-none [&_a]:font-bold [&_a]:text-travel-forest [&_a]:underline-offset-3"
          >
            <span className="font-bold">{kind}: </span>
            <span>{title}</span>
            {lines
              .filter((line): line is string => !!line)
              .map((line) => (
                <span key={line} className="block text-travel-muted">
                  {line}
                </span>
              ))}
            {anchor === "stay" && <span className="block">{navigationLink?.(item)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The dated story: an index, then each update with its place, photos and text. */
function Updates({
  updates,
  media,
  fileUrl,
  besideMap = false,
  onActive,
  context,
  navigationLink,
}: {
  updates: ProjectionUpdate[];
  media: ProjectionMedia[];
  /** Approved visits, stays and routes tied to exactly one update by their shared area and day. */
  context?: Map<string, UpdateContext>;
  navigationLink?: (item: ProjectionItem) => ReactNode;
  fileUrl: (item: ProjectionItem) => string | null;
  /** The map sits beside this story on a wide screen, so the story is one column with its index folded away. */
  besideMap?: boolean;
  onActive?: (id: string | null) => void;
}) {
  const lang = useTextLang();
  useLocale();
  const timeline = useRef<HTMLOListElement>(null);
  useActiveUpdate(timeline, besideMap && !!onActive, (id) => onActive?.(id));
  if (!updates.length) return null;
  return (
    <section
      id="story"
      tabIndex={-1}
      className="travel-card scroll-mt-4 focus:outline-none"
      aria-label={m.visitor_updates()}
    >
      <h2 className="sr-only">{m.visitor_updates()}</h2>
      <div className={besideMap ? "grid gap-3" : "travel-story-split"}>
        <Collapsible.Root className={cn("min-w-0", !besideMap && "min-[1100px]:hidden")}>
          <Collapsible.Trigger className="min-h-11 rounded-travel-control bg-transparent px-3 py-2 text-sm font-bold text-travel-forest underline underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus">
            {m.visitor_choose_update()}
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <nav aria-label={m.visitor_story_navigation()} className="pt-4">
              <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 min-[1100px]:flex-col min-[1100px]:gap-y-3">
                {updates.map((item) => (
                  <li key={item.id}>
                    <a
                      className="text-sm font-bold text-travel-forest underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
                      href={`#${item.id}`}
                      lang={text(item.title) ? lang(item.title_lang) : undefined}
                    >
                      {text(item.title) ??
                        storyDate(item.story_date, item.date_precision) ??
                        m.visitor_update()}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </Collapsible.Panel>
        </Collapsible.Root>
        {!besideMap && (
          <nav
            aria-label={m.visitor_story_navigation()}
            className="hidden min-w-0 self-start min-[1100px]:block min-[1100px]:sticky min-[1100px]:top-6 min-[1100px]:max-h-travel-lightbox min-[1100px]:overflow-y-auto"
          >
            <ol className="m-0 flex list-none flex-wrap gap-x-4 gap-y-2 p-0 min-[1100px]:flex-col min-[1100px]:gap-y-3">
              {updates.map((item) => (
                <li key={item.id}>
                  <a
                    className="text-sm font-bold text-travel-forest underline-offset-3 focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus"
                    href={`#${item.id}`}
                    lang={text(item.title) ? lang(item.title_lang) : undefined}
                  >
                    {text(item.title) ??
                      storyDate(item.story_date, item.date_precision) ??
                      m.visitor_update()}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <ol
          ref={timeline}
          aria-label={m.visitor_timeline()}
          className="m-0 grid min-w-0 list-none gap-10 border-l-2 border-travel-border py-0 pr-0 pl-6 min-[680px]:gap-12 min-[680px]:pl-8"
        >
          {updates.map((item, index) => (
            <li className="relative min-w-0 scroll-mt-6" key={item.id} id={item.id} tabIndex={-1}>
              <span
                aria-hidden="true"
                className="absolute top-2.5 -left-8.25 size-3 rounded-full bg-travel-forest min-[680px]:-left-10.25"
              />
              {daysLater(updates[index - 1], item) !== null && (
                <p className="mb-3 text-xs font-bold tracking-travel-eyebrow text-travel-muted uppercase">
                  {m.visitor_days_later({ count: daysLater(updates[index - 1], item)! })}
                </p>
              )}
              <article className="grid gap-3">
                <Authored
                  as="h3"
                  className="m-0 text-travel-card-title leading-tight font-extrabold tracking-tight"
                  of={text(item.title)}
                  marker={item.title_lang}
                  fallback={m.visitor_update()}
                />
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-travel-muted">
                  {storyDate(item.story_date, item.date_precision) ? (
                    <time dateTime={text(item.story_date) ?? undefined}>
                      {storyDate(item.story_date, item.date_precision)}
                    </time>
                  ) : precision(item) ? (
                    <span>{precision(item)}</span>
                  ) : null}
                  {item.place && place(item.place) && (
                    <span>
                      <PlaceText area={item.place} />
                    </span>
                  )}
                </div>
                <Gallery
                  items={media.filter((image) => image.update === item.id)}
                  fileUrl={fileUrl}
                  title={m.visitor_update_media_named({
                    number: index + 1,
                    title: text(item.title) ?? m.visitor_update(),
                  })}
                  heading={false}
                  lead
                />
                <Markdown
                  under={3}
                  className="max-w-travel-reading leading-relaxed"
                  lang={lang(item.body_lang)}
                  html={text(item.body_html)}
                  text={text(item.body)}
                />
                {context?.get(item.id) && (
                  <UpdateContextBlock
                    context={context.get(item.id)!}
                    navigationLink={navigationLink}
                  />
                )}
              </article>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function ProjectionStory({
  projection,
  fileUrl,
  onActive,
  context,
  navigationLink,
}: {
  projection: Projection;
  fileUrl: (item: ProjectionItem) => string | null;
  onActive: (id: string | null) => void;
  context: Map<string, UpdateContext>;
  navigationLink: (item: ProjectionItem) => ReactNode;
}) {
  const lang = useTextLang();
  const updateIds = new Set(projection.updates.map((item) => item.id));
  const looseMedia = projection.media.filter(
    (item) => typeof item.update !== "string" || !updateIds.has(item.update),
  );
  const overview = projection.summary ? (
    <section className="travel-card" aria-label={m.visitor_overview()}>
      <h2>{m.visitor_overview()}</h2>
      <Markdown
        under={2}
        className="max-w-travel-reading leading-relaxed"
        lang={lang(projection.summary_lang)}
        html={projection.summary_html}
        text={projection.summary}
      />
    </section>
  ) : null;

  return (
    <>
      <Updates
        updates={projection.updates}
        media={projection.media}
        fileUrl={fileUrl}
        besideMap
        onActive={onActive}
        context={context}
        navigationLink={navigationLink}
      />
      {projection.updates.length === 0 && (
        <section className="travel-card">
          <h2>{m.visitor_no_story()}</h2>
          <p>{m.visitor_no_story_description()}</p>
        </section>
      )}
      {overview}
      {looseMedia.length > 0 && (
        <section className="travel-card" aria-label={m.visitor_gallery()}>
          <h2 className="mb-4.5">{m.visitor_gallery()}</h2>
          <Gallery
            items={looseMedia}
            fileUrl={fileUrl}
            title={m.visitor_shared_photos()}
            heading={false}
          />
        </section>
      )}
    </>
  );
}
