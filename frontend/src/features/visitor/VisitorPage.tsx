import { useCallback, useEffect, useRef, useState } from "react";
import type { CollectionIndex } from "@/api-types";
import { VisitorTopBar } from "@/components/VisitorTopBar";
import {
  isProjection,
  ProjectionView,
  type Audience,
  type Projection,
} from "@/components/projection/ProjectionView";
import { deliveredLanguage, withLanguage } from "@/components/projection/visitor-language";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import type { ContentLanguage } from "@/i18n/content-language";
import { adoptLocale, chosenLocale, useLocale } from "@/i18n/locale";
import { ApiError, apiFailure, errorMessage } from "@/lib/api/api";
import { m } from "@/paraglide/messages.js";
import { CollectionIndexView, isCollectionIndex } from "./CollectionIndexView";
import { LONG_TITLE_CLASS, LONG_TITLE_LENGTH, OwnerLink } from "./VisitorPageChrome";
import { forgetSharedTrip, rememberSharedTrip } from "./saved-shared-trips";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; projection: Projection; language: ContentLanguage | null }
  | { kind: "collection"; index: CollectionIndex; language: ContentLanguage | null }
  | { kind: "unavailable" }
  | { kind: "error"; failure?: ApiError };

export function VisitorPage({
  audience,
  identifier,
  memberId,
}: {
  audience: Audience;
  identifier: string;
  /** A trip inside a collection link; `identifier` is then the collection's token. */
  memberId?: string;
}) {
  const locale = useLocale();
  // The language this page took from the trip itself (see below), when the visitor had chosen none.
  const [adopted, setAdopted] = useState<ContentLanguage | null>(null);
  // What the visitor chose themselves, here or on an earlier visit. Without a choice the document comes in the
  // trip's own language (the server says which) and the interface follows it; a later choice asks for the
  // document again in that language. Back in the trip's own language there is nothing to ask for.
  const requested = adopted !== null && locale !== adopted ? locale : chosenLocale();
  // A new choice of language replaces the texts without blanking the page; another trip or a retry starts over.
  const loadedFor = useRef("");
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
    const key = `${audience}|${identifier}|${memberId ?? ""}|${attempt}`;
    const restarted = loadedFor.current !== key;
    if (restarted) {
      loadedFor.current = key;
      setState({ kind: "loading" });
      setStorageFailed(false);
      setSaved(null);
    }
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
        const response = await fetch(withLanguage(path, requested), {
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
            const language = requested ?? deliveredLanguage(response);
            if (!requested && language) {
              adoptLocale(language);
              setAdopted(language);
            }
            if (audience === "share" && !memberId && isCollectionIndex(data)) {
              if (!refresh) {
                const remembered = rememberSharedTrip(identifier, { title: data.title });
                setStorageFailed(!remembered);
                setSaved(remembered ? "saved" : null);
              }
              setState({ kind: "collection", index: data, language });
            } else if (isProjection(data, audience)) {
              if (!refresh && audience === "share" && !memberId) {
                const remembered = rememberSharedTrip(identifier, data);
                setStorageFailed(!remembered);
                setSaved(remembered ? "saved" : null);
              }
              setState({ kind: "ready", projection: data, language });
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
    void load(!restarted);
    // Re-evaluate delayed cutoffs and scope revocation without new ingestion.
    const timer = window.setInterval(() => void load(true), 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [audience, identifier, memberId, attempt, requested]);

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
        <CollectionIndexView index={state.index} token={identifier} language={state.language} />
      )}
      {state.kind === "ready" && (
        <ProjectionView
          projection={state.projection}
          language={state.language}
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
