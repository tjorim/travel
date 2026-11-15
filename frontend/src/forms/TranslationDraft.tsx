import { Alert } from "@/ui/alert";
import { Button } from "@/ui/button";
import { useEffect, useRef, useState } from "react";

import { type ContentLanguage } from "../content-language";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import type { TranslationDraftResponse } from "../api-types";
import { ownerRequest } from "../query/api";
import {
  errorNotice,
  noticeMessage,
  textNotice,
  type ErrorNotice,
  type MessageNotice,
} from "../query/feedback";
import { useOwner } from "../query/owner-queries";

type State = { kind: "working" } | { kind: "error"; notice: ErrorNotice | MessageNotice };

/** "Draft from Dutch" / "Draft from English": the one action a field offers, for the language still empty. */
export const draftActionLabel = (source: ContentLanguage) =>
  source === "nl" ? m.translations_draft_from_dutch() : m.translations_draft_from_english();

/**
 * Explicit, owner-requested machine translation of one field into its empty language. The result goes
 * straight into that language's field, where the owner reviews and edits it; it is never stored until the
 * record is saved, and nothing is ever replaced (the target is empty, which is what offers the action).
 */
export function TranslationDraft({
  source,
  target,
  text,
  onDraft,
}: {
  /** The language the text is in. */
  source: ContentLanguage;
  /** The empty language the draft fills. */
  target: ContentLanguage;
  /** The text to translate: the other language's version of the same field. */
  text: string;
  /** Receives the draft; the caller puts it in the field and marks it as unreviewed. */
  onDraft: (draft: string) => void;
}) {
  useLocale();
  const [run, setRun] = useState<number | null>(null);
  return (
    <div className="grid gap-2">
      <div>
        <Button
          type="button"
          className="compact secondary"
          disabled={!text.trim() || run !== null}
          onClick={() => setRun((previous) => (previous ?? 0) + 1)}
        >
          {draftActionLabel(source)}
        </Button>
      </div>
      {run !== null && (
        <TranslationRun
          key={run}
          text={text}
          source={source}
          target={target}
          retry={() => setRun((previous) => (previous ?? 0) + 1)}
          close={() => setRun(null)}
          onDraft={(draft) => {
            onDraft(draft);
            setRun(null);
          }}
        />
      )}
    </div>
  );
}

/** One translation request. Closing or restarting unmounts it, which aborts the request in flight. */
function TranslationRun({
  text,
  source,
  target,
  retry,
  close,
  onDraft,
}: {
  text: string;
  source: ContentLanguage;
  target: ContentLanguage;
  retry: () => void;
  close: () => void;
  onDraft: (draft: string) => void;
}) {
  useLocale();
  const owner = useOwner();
  const [state, setState] = useState<State>({ kind: "working" });
  const deliver = useRef(onDraft);
  deliver.current = onDraft;

  // The source text is captured when the request starts; later edits do not restart it.
  useEffect(() => {
    if (!owner) {
      setState({ kind: "error", notice: textNotice(m.api_unauthorized) });
      return;
    }
    const controller = new AbortController();
    ownerRequest<TranslationDraftResponse>(
      owner.session,
      "/api/translation/drafts",
      m.translations_error,
      { method: "POST", body: { text, source, target }, signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) deliver.current(result.text);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ kind: "error", notice: errorNotice(error, m.translations_error) });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "working")
    return (
      <div className="flex flex-wrap items-center gap-2" role="status">
        <span className="help">{m.translations_first_run_hint()}</span>
        <Button type="button" className="compact secondary" onClick={close}>
          {m.cancel()}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Alert variant="error" role="alert">
        {noticeMessage(state.notice)}
      </Alert>
      <Button type="button" className="compact secondary" onClick={retry}>
        {m.retry()}
      </Button>
      <Button type="button" className="compact secondary" onClick={close}>
        {m.cancel()}
      </Button>
    </div>
  );
}
