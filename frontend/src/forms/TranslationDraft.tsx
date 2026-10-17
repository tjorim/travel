import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";

import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { ownerRequest } from "../query/api";
import {
  errorNotice,
  noticeMessage,
  textNotice,
  type ErrorNotice,
  type MessageNotice,
} from "../query/feedback";
import { useOwner } from "../query/owner-queries";
import { Field, FieldLabel } from "../ui/field";
import { TravelTextarea } from "../ui/TravelTextarea";

type Language = "nl" | "en";
type Direction = { source: Language; target: Language };
type Run = Direction & { id: number };

const DIRECTIONS: Direction[] = [
  { source: "nl", target: "en" },
  { source: "en", target: "nl" },
];

type State =
  | { kind: "working" }
  | { kind: "error"; notice: ErrorNotice | MessageNotice }
  | { kind: "draft"; text: string };

/**
 * Explicit, owner-requested machine translation of one field. The result is an editable draft that
 * is only ever appended to the text on request: it never replaces or auto-saves authored text.
 */
export function TranslationDraft({
  label,
  value,
  onAppend,
}: {
  label: string;
  value: string;
  /** Adds the reviewed draft below the authored text. */
  onAppend: (draft: string) => void;
}) {
  useLocale();
  const [run, setRun] = useState<Run | null>(null);
  const start = (direction: Direction) =>
    setRun((previous) => ({ ...direction, id: (previous?.id ?? 0) + 1 }));

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1">
        {DIRECTIONS.map((direction) => (
          <Button
            key={direction.target}
            type="button"
            className="compact secondary"
            disabled={!value.trim()}
            onClick={() => start(direction)}
          >
            {direction.target === "en"
              ? m.owner_translate_to_english()
              : m.owner_translate_to_dutch()}
          </Button>
        ))}
      </div>
      {run && (
        <TranslationRun
          key={run.id}
          label={label}
          text={value}
          direction={run}
          retry={() => start(run)}
          close={() => setRun(null)}
          onAppend={(draft) => {
            onAppend(draft);
            setRun(null);
          }}
        />
      )}
    </div>
  );
}

/** One translation request. Closing or restarting unmounts it, which aborts the request in flight. */
function TranslationRun({
  label,
  text,
  direction: { source, target },
  retry,
  close,
  onAppend,
}: {
  label: string;
  text: string;
  direction: Direction;
  retry: () => void;
  close: () => void;
  onAppend: (draft: string) => void;
}) {
  useLocale();
  const owner = useOwner();
  const [state, setState] = useState<State>({ kind: "working" });

  // The source text is captured when the request starts; later edits do not restart it.
  useEffect(() => {
    if (!owner) {
      setState({ kind: "error", notice: textNotice(m.api_unauthorized) });
      return;
    }
    const controller = new AbortController();
    ownerRequest<{ text: string }>(
      owner.session,
      "/api/translation/drafts",
      m.owner_the_translation_could_not_be_made_your_text_is_unchanged,
      { method: "POST", body: { text, source, target }, signal: controller.signal },
    )
      .then((result) => setState({ kind: "draft", text: result.text }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            kind: "error",
            notice: errorNotice(
              error,
              m.owner_the_translation_could_not_be_made_your_text_is_unchanged,
            ),
          });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === "working")
    return (
      <div className="flex flex-wrap items-center gap-2" role="status">
        <span className="help">{m.owner_translating_this_can_take_a_while_the_first_time()}</span>
        <Button type="button" className="compact secondary" onClick={close}>
          {m.owner_cancel()}
        </Button>
      </div>
    );
  if (state.kind === "error")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="form-error" role="alert">
          {noticeMessage(state.notice)}
        </p>
        <Button type="button" className="compact secondary" onClick={retry}>
          {m.owner_try_again()}
        </Button>
        <Button type="button" className="compact secondary" onClick={close}>
          {m.owner_cancel()}
        </Button>
      </div>
    );
  return (
    <section className="grid gap-2 rounded-lg border border-dashed border-travel-control-border p-3">
      <h4 className="m-0 text-sm font-bold">{m.owner_machine_translated_draft()}</h4>
      <p className="help m-0">
        {m.owner_check_names_of_places_and_dishes_and_expressions_before_using_the_draft()}
      </p>
      <Field>
        <FieldLabel>
          <span>{m.owner_translation_draft_for({ p0: label })}</span>
        </FieldLabel>
        <TravelTextarea
          lang={target}
          value={state.text}
          onChange={(event) => setState({ kind: "draft", text: event.target.value })}
        />
      </Field>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          className="compact"
          disabled={!state.text.trim()}
          onClick={() => onAppend(state.text)}
        >
          {m.owner_add_below_the_text()}
        </Button>
        <Button type="button" className="compact secondary" onClick={close}>
          {m.owner_discard_draft()}
        </Button>
      </div>
    </section>
  );
}
