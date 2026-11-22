import type { ProjectionItem, ProjectionMedia } from "@/api-types";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useLocale } from "@/i18n/locale";
import { m } from "@/paraglide/messages.js";
import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon, ImagesIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { text } from "./projectionFormatting";
import { focus, hasFileMarker, positiveSize } from "./projectionMedia";
import { useTextLang } from "./visitor-language";

/** The alt text of a shared photo, with a translated fallback. */
function photoAlt(item: ProjectionMedia) {
  return text(item.alt_text) ?? m.visitor_shared_image();
}

/** One shared photo as a button that opens the gallery's lightbox on it; a failed load offers a retry. */
function SharedImage({
  item,
  url,
  onOpen,
  triggerRef,
  fill = false,
  hint,
}: {
  item: ProjectionMedia;
  url: string;
  onOpen: () => void;
  triggerRef: (element: HTMLButtonElement | null) => void;
  /** A mosaic tile fills the box its parent gives it and crops to it, around the photo's focal point. */
  fill?: boolean;
  hint?: string;
}) {
  useLocale();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const alt = photoAlt(item);
  const lang = useTextLang();
  const open = m.visitor_open_image({ title: alt });
  const button = (
    <Button
      ref={triggerRef}
      type="button"
      className={cn(
        "block w-full cursor-pointer rounded-travel-media border-0 bg-transparent p-0 text-travel-ink transition duration-150 hover:brightness-105 motion-reduce:transition-none focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-travel-focus",
        fill &&
          "relative min-h-0 flex-1 overflow-hidden bg-travel-tint text-sm focus-visible:-outline-offset-3",
      )}
      aria-label={failed ? `${m.visitor_image_failed()} ${open}` : open}
      onClick={onOpen}
    >
      <img
        key={`${url}:${attempt}`}
        className={cn(
          "block bg-travel-tint object-cover",
          fill
            ? "absolute inset-0 size-full"
            : "aspect-4/3 h-auto w-full rounded-travel-media shadow-travel-card",
        )}
        src={url}
        alt={alt}
        lang={text(item.alt_text) ? lang(item.alt_text_lang) : undefined}
        width={positiveSize(item, "width")}
        height={positiveSize(item, "height")}
        style={{ objectPosition: `${focus(item, "focal_x")}% ${focus(item, "focal_y")}%` }}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        hidden={failed}
      />
      {failed && m.visitor_image_failed()}
    </Button>
  );
  const status = failed && (
    <div role="status">
      <p>{m.visitor_image_failed()}</p>
      <Button
        type="button"
        onClick={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      >
        {m.retry()}
      </Button>
    </div>
  );
  if (!fill)
    return (
      <>
        {button}
        {status}
      </>
    );
  return (
    <div className="flex size-full min-h-0 flex-col">
      {button}
      {status}
      {hint && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1.5 rounded-full bg-travel-hero-scrim/80 px-2.5 py-1 text-xs font-bold text-travel-hero-ink"
        >
          <ImagesIcon aria-hidden="true" className="size-3.5" />
          {hint}
        </span>
      )}
    </div>
  );
}

/** The enlarged photo of the lightbox, its caption over the bottom; a failed load offers a retry for this photo only. */
function LightboxImage({ item, url }: { item: ProjectionMedia; url: string }) {
  const lang = useTextLang();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return (
    <figure className="pointer-events-none absolute inset-0 m-0 grid grid-cols-1 grid-rows-1 place-items-center">
      <img
        key={`${url}:${attempt}`}
        className="max-h-full max-w-full object-contain select-none"
        src={url}
        alt={photoAlt(item)}
        lang={text(item.alt_text) ? lang(item.alt_text_lang) : undefined}
        width={positiveSize(item, "width")}
        height={positiveSize(item, "height")}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        hidden={failed}
        draggable={false}
      />
      {failed && (
        <div role="status" className="pointer-events-auto grid justify-items-center gap-3">
          <p className="m-0">{m.visitor_image_failed()}</p>
          <Button
            type="button"
            className="border border-white/40 bg-transparent text-travel-lightbox-ink focus-visible:outline-travel-lightbox-focus"
            onClick={() => {
              setFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            {m.retry()}
          </Button>
        </div>
      )}
      <Markdown
        as="figcaption"
        className="pointer-events-auto absolute inset-x-0 bottom-0 max-h-2/5 overflow-y-auto bg-linear-to-t from-travel-lightbox/90 via-travel-lightbox/75 to-transparent px-5 pt-12 pb-travel-safe-bottom text-center leading-normal text-travel-lightbox-ink min-[680px]:px-travel-lightbox-caption"
        lang={lang(item.caption_lang)}
        html={text(item.caption_html)}
        text={text(item.caption)}
      />
    </figure>
  );
}

type Photo = { item: ProjectionMedia; url: string };

/** Fewer pixels than this, or a mostly vertical drag, is a scroll or a tap rather than a swipe. */
const SWIPE_DISTANCE = 48;

/**
 * One dark, full-bleed dialog for all the photos of a gallery: previous and next buttons, the arrow keys and a
 * horizontal swipe move through them, a label gives the position, the caption sits over the bottom of the photo,
 * and closing returns focus to the photo's own button. Only the neighbouring approved derivatives are preloaded.
 * The interface language is not switched here: a photo's delivered alt text and caption have no translation to
 * switch to, and the language choice stays in the page's preferences.
 */
function PhotoLightbox({
  photos,
  index,
  onIndex,
  onClose,
  returnFocus,
}: {
  photos: Photo[];
  index: number | null;
  onIndex: (index: number) => void;
  onClose: () => void;
  returnFocus: (index: number) => HTMLElement | boolean;
}) {
  useLocale();
  // The dialog keeps showing the last photo while it fades out.
  const last = useRef(0);
  if (index !== null) last.current = index;
  const current = Math.min(last.current, photos.length - 1);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const before = index === null ? undefined : photos[index - 1]?.url;
  const after = index === null ? undefined : photos[index + 1]?.url;
  useEffect(() => {
    // Only the neighbouring approved derivatives are fetched ahead, never an original.
    for (const url of [before, after]) {
      if (!url) continue;
      const image = new Image();
      image.referrerPolicy = "no-referrer";
      image.src = url;
    }
  }, [before, after]);
  const photo = photos[current];
  if (!photo) return null;
  const go = (step: -1 | 1) => {
    const next = current + step;
    if (next >= 0 && next < photos.length) onIndex(next);
  };
  const control =
    "pointer-events-auto grid size-11 shrink-0 place-items-center rounded-full border border-white/30 bg-travel-lightbox/70 p-0 text-travel-lightbox-ink backdrop-blur-sm hover:bg-travel-lightbox data-disabled:opacity-30 focus-visible:outline-travel-lightbox-focus";
  return (
    <Dialog.Root open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-travel-lightbox travel-backdrop-motion" />
        <Dialog.Viewport className="fixed inset-0 z-50">
          <Dialog.Popup
            className="relative size-full overflow-hidden bg-travel-lightbox text-travel-lightbox-ink travel-backdrop-motion"
            finalFocus={() => returnFocus(current)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (event.key === "ArrowLeft") go(-1);
              else if (event.key === "ArrowRight") go(1);
              else return;
              event.preventDefault();
            }}
          >
            <Dialog.Title className="sr-only">{photoAlt(photo.item)}</Dialog.Title>
            <div
              className="absolute inset-0 touch-pan-y"
              onPointerDown={(event) => {
                swipe.current =
                  event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY };
              }}
              onPointerCancel={() => (swipe.current = null)}
              onPointerUp={(event) => {
                const start = swipe.current;
                swipe.current = null;
                if (!start) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * 1.5)
                  go(dx < 0 ? 1 : -1);
              }}
            >
              <LightboxImage key={photo.item.id} item={photo.item} url={photo.url} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 bg-linear-to-b from-travel-lightbox/85 to-transparent px-4 pt-travel-safe-top pb-6">
              {photos.length > 1 ? (
                <p
                  className="m-0 rounded-full bg-travel-lightbox/70 px-3 py-1.5 text-sm font-bold"
                  role="status"
                >
                  {m.visitor_photo_position({ current: current + 1, total: photos.length })}
                </p>
              ) : (
                <span />
              )}
              <Dialog.Close className={control} aria-label={m.visitor_close_image()}>
                <XIcon aria-hidden="true" className="size-5" />
              </Dialog.Close>
            </div>
            {photos.length > 1 && (
              <nav
                className="pointer-events-none absolute inset-x-3 top-1/2 z-10 flex -translate-y-1/2 justify-between"
                aria-label={m.visitor_photo_navigation()}
              >
                <Button
                  type="button"
                  className={control}
                  focusableWhenDisabled
                  disabled={current === 0}
                  aria-label={m.visitor_previous_photo()}
                  onClick={() => go(-1)}
                >
                  <ChevronLeftIcon aria-hidden="true" className="size-5" />
                </Button>
                <Button
                  type="button"
                  className={control}
                  focusableWhenDisabled
                  disabled={current === photos.length - 1}
                  aria-label={m.visitor_next_photo()}
                  onClick={() => go(1)}
                >
                  <ChevronRightIcon aria-hidden="true" className="size-5" />
                </Button>
              </nav>
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** One shared video with controls and a poster, fetched only when played. */
function SharedVideo({
  item,
  url,
  poster,
}: {
  item: ProjectionMedia;
  url: string;
  poster?: string;
}) {
  const lang = useTextLang();
  useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <>
      <video
        className="block w-full rounded-travel-media"
        controls
        preload="none"
        playsInline
        poster={poster}
        aria-label={text(item.alt_text) ?? m.visitor_shared_video()}
        lang={text(item.alt_text) ? lang(item.alt_text_lang) : undefined}
        width={positiveSize(item, "width")}
        height={positiveSize(item, "height")}
        onError={() => setFailed(true)}
      >
        <source src={url} type="video/mp4" onError={() => setFailed(true)} />
      </video>
      {failed && <p role="status">{m.visitor_video_failed()}</p>}
    </>
  );
}

/** Rows of the smaller tiles under a mosaic's lead photo: three to a row, never one alone, so each row fills the width. */
function tileRows(count: number): number[] {
  const rows: number[] = Array(Math.floor(count / 3)).fill(3);
  const rest = count % 3;
  if (rest === 2) rows.push(2);
  else if (rest === 1) {
    if (rows.length) {
      rows.pop();
      rows.push(2, 2);
    } else rows.push(1);
  }
  return rows;
}
/** The span of a tile in a six-column row, by how many tiles share its row. */
const TILE_SPAN: Record<number, string> = { 1: "col-span-6", 2: "col-span-3", 3: "col-span-2" };

/**
 * The photos and videos of a story, as a grid. With `lead` an update's photos are arranged to be seen at a glance:
 * one photo wide; two side by side with the first larger; three or more as a large first photo over a mosaic of
 * the rest, with the count shown. A video always keeps its own full-width frame under the photos.
 */
export function Gallery({
  items,
  fileUrl,
  title = m.visitor_gallery(),
  heading = true,
  lead = false,
}: {
  items: ProjectionMedia[];
  fileUrl: (item: ProjectionItem) => string | null;
  title?: string;
  /** A gallery already under a heading of its own is named for assistive technology only. */
  heading?: boolean;
  /** Lead with the photos: one wide frame, or a mosaic with a larger first photo. */
  lead?: boolean;
}) {
  const lang = useTextLang();
  useLocale();
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [open, setOpen] = useState<number | null>(null);
  const photos = items.flatMap((item) => {
    const url = hasFileMarker(item, "image") ? fileUrl(item) : null;
    return url ? [{ item, url }] : [];
  });
  if (!items.length) return null;
  const images = items.filter((item) => hasFileMarker(item, "image"));
  const mosaic = lead && images.length >= 2;
  const rest = mosaic ? items.filter((item) => !images.includes(item)) : items;
  const trigger = (item: ProjectionMedia) => (element: HTMLButtonElement | null) => {
    if (element) triggers.current.set(item.id, element);
    else triggers.current.delete(item.id);
  };
  const tile = (item: ProjectionMedia, hint?: string) =>
    fileUrl(item) ? (
      <SharedImage
        fill
        hint={hint}
        item={item}
        url={fileUrl(item)!}
        onOpen={() => setOpen(photos.findIndex((photo) => photo.item.id === item.id))}
        triggerRef={trigger(item)}
      />
    ) : (
      <p
        className="m-0 flex size-full items-center justify-center gap-2 bg-travel-tint"
        role="status"
      >
        <Spinner />
        {m.visitor_image_loading()}
      </p>
    );
  const count = m.visitor_photo_count({ count: images.length });
  const rows = mosaic
    ? tileRows(images.length - 1).flatMap((size) => Array<number>(size).fill(size))
    : [];
  return (
    <section className={cn("min-w-0", heading && "mt-6")} aria-label={title}>
      {heading && <h4 className="mb-3 text-base">{title}</h4>}
      {mosaic && (
        <ul
          data-mosaic=""
          className={cn(
            "m-0 grid list-none gap-1.5 p-0",
            images.length === 2
              ? "h-travel-mosaic-pair grid-cols-travel-mosaic-pair min-[680px]:h-travel-mosaic-pair-wide"
              : "grid-cols-6",
          )}
        >
          {images.map((item, position) => (
            <li
              key={item.id}
              className={cn(
                "relative min-h-0 min-w-0 overflow-hidden rounded-travel-media shadow-travel-card",
                images.length > 2 &&
                  (position === 0
                    ? "col-span-6 aspect-4/3 min-[680px]:aspect-3/2"
                    : cn(
                        TILE_SPAN[rows[position - 1]!],
                        "min-h-travel-mosaic-row min-[680px]:min-h-travel-mosaic-row-wide",
                      )),
              )}
            >
              {tile(item, position === 0 ? count : undefined)}
            </li>
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <ul
          className={cn(
            "m-0 grid list-none gap-3.5 p-0",
            mosaic && "mt-3.5",
            lead
              ? "grid-cols-1"
              : "grid-cols-1 min-[560px]:grid-cols-2 min-[960px]:grid-cols-3 min-[1500px]:grid-cols-4",
          )}
        >
          {rest.map((item) => (
            <li className={cn("min-w-0", lead && "max-w-170")} key={item.id}>
              <figure className="m-0">
                {hasFileMarker(item, "image") &&
                  (fileUrl(item) ? (
                    <SharedImage
                      item={item}
                      url={fileUrl(item)!}
                      onOpen={() => setOpen(photos.findIndex((photo) => photo.item.id === item.id))}
                      triggerRef={trigger(item)}
                    />
                  ) : (
                    <p className="flex items-center gap-2" role="status">
                      <Spinner />
                      {m.visitor_image_loading()}
                    </p>
                  ))}
                {hasFileMarker(item, "video") && fileUrl(item) && (
                  <SharedVideo
                    item={item}
                    url={fileUrl(item)!}
                    poster={fileUrl({ id: `${item.id}-poster` }) ?? undefined}
                  />
                )}
                {hasFileMarker(item, "video") && !fileUrl(item) && (
                  <p className="flex items-center gap-2" role="status">
                    <Spinner />
                    {m.visitor_video_loading()}
                  </p>
                )}
                <Markdown
                  as="figcaption"
                  className="mt-1.75 wrap-anywhere leading-normal text-travel-muted"
                  lang={lang(item.caption_lang)}
                  html={text(item.caption_html)}
                  text={text(item.caption)}
                />
              </figure>
            </li>
          ))}
        </ul>
      )}
      <PhotoLightbox
        photos={photos}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
        returnFocus={(position) => {
          const element = triggers.current.get(photos[position]?.item.id ?? "");
          return element ?? true;
        }}
      />
    </section>
  );
}
