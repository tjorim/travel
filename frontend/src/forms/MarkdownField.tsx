import { Button } from "@base-ui/react/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field";
import { TravelTextarea } from "../ui/TravelTextarea";
import type { AnyFieldApi } from "@tanstack/react-form";
import { cn } from "cn";
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";

import { Markdown } from "../Markdown";
import { errorMessage, ownerRequest } from "../query/api";
import { useOwner } from "../query/owner-queries";
import { optionalNote, useFieldErrors } from "./fields";
import { applyMarkdownSnippet, type MarkdownSnippet } from "./markdown-snippets";

/** How the server renders the field: long-form Markdown, an inline-only caption, or contact details. */
export type MarkdownFormat = "markdown" | "inline" | "contact";

const SNIPPETS: Record<MarkdownFormat, { snippet: MarkdownSnippet; label: string; text: string }[]> = {
  markdown: [
    { snippet: "bold", label: "Vet", text: "B" },
    { snippet: "italic", label: "Cursief", text: "I" },
    { snippet: "heading", label: "Kop", text: "H" },
    { snippet: "list", label: "Lijst", text: "•" },
    { snippet: "tasks", label: "Takenlijst", text: "☐" },
    { snippet: "link", label: "Link", text: "Link" },
  ],
  inline: [
    { snippet: "bold", label: "Vet", text: "B" },
    { snippet: "italic", label: "Cursief", text: "I" },
    { snippet: "link", label: "Link", text: "Link" },
  ],
  contact: [],
};

const HINTS: Record<MarkdownFormat, string> = {
  markdown: "Markdown: **vet**, *cursief*, koppen, lijsten, takenlijsten, links en tabellen.",
  inline: "Alleen **vet**, *cursief* en links.",
  contact: "Gewone tekst: telefoonnummers, e-mail- en webadressen worden links.",
};

type RenderResult = { html: string | null; text: string | null };

/**
 * The server's rendering of the current text: the same renderer as the stored field, so the preview
 * and what visitors see never drift apart.
 */
function MarkdownPreview({ source, format }: { source: string; format: MarkdownFormat }) {
  const owner = useOwner();
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; result: RenderResult } | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    if (!owner) {
      setState({ kind: "error", message: "Meld je aan om een voorbeeld te zien." });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    ownerRequest<RenderResult>(owner.session, "/api/markdown/render", "Het voorbeeld kon niet worden geladen.", {
      method: "POST",
      body: { source, format },
      signal: controller.signal,
    })
      .then((result) => setState({ kind: "ready", result }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({ kind: "error", message: errorMessage(error, "Het voorbeeld kon niet worden geladen.") });
      });
    return () => controller.abort();
  }, [owner, source, format]);

  if (state.kind === "loading")
    return (
      <p className="help" role="status">
        Voorbeeld laden…
      </p>
    );
  if (state.kind === "error")
    return (
      <p className="form-error" role="alert">
        {state.message}
      </p>
    );
  if (!state.result.html) return <p className="help">Nog niets om te tonen.</p>;
  return <Markdown html={state.result.html} text={source} />;
}

/**
 * A textarea for a Markdown field with a small snippet toolbar and a Preview tab rendered by the
 * server. No WYSIWYG: the owner writes the source, which is what is stored.
 */
export function MarkdownField({
  field,
  label,
  optional,
  format = "markdown",
  ...input
}: { field: AnyFieldApi; label: string; optional?: string | boolean; format?: MarkdownFormat } & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onBlur" | "name" | "id"
>) {
  const { message, invalid } = useFieldErrors(field);
  const [previewing, setPreviewing] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  const value: string = field.state.value ?? "";
  const { required, ...rest } = input;

  useEffect(() => {
    const selection = pendingSelection.current;
    if (!selection || !textarea.current) return;
    pendingSelection.current = null;
    textarea.current.focus();
    textarea.current.setSelectionRange(selection[0], selection[1]);
  }, [value]);

  const apply = (snippet: MarkdownSnippet) => {
    const element = textarea.current;
    const edit = applyMarkdownSnippet(
      value,
      element?.selectionStart ?? value.length,
      element?.selectionEnd ?? value.length,
      snippet,
    );
    pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
    field.handleChange(edit.value);
  };

  return (
    <Field name={field.name} invalid={invalid}>
      <FieldLabel>
        <span>
          {label}
          {optionalNote(optional)}
        </span>
      </FieldLabel>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Weergave van ${label.toLowerCase()}`}>
          <Button
            type="button"
            className="compact aria-[pressed=false]:bg-transparent aria-[pressed=false]:text-travel-forest aria-[pressed=false]:ring-1 aria-[pressed=false]:ring-travel-control-border"
            aria-pressed={!previewing}
            onClick={() => setPreviewing(false)}
          >
            Schrijven
          </Button>
          <Button
            type="button"
            className="compact aria-[pressed=false]:bg-transparent aria-[pressed=false]:text-travel-forest aria-[pressed=false]:ring-1 aria-[pressed=false]:ring-travel-control-border"
            aria-pressed={previewing}
            onClick={() => setPreviewing(true)}
          >
            Voorbeeld
          </Button>
        </div>
        {!previewing && SNIPPETS[format].length > 0 && (
          <div className="flex flex-wrap gap-1" role="toolbar" aria-label={`Opmaak voor ${label.toLowerCase()}`}>
            {SNIPPETS[format].map(({ snippet, label: name, text }) => (
              <Button
                key={snippet}
                type="button"
                className={cn(
                  "compact secondary min-w-9",
                  snippet === "bold" && "font-extrabold",
                  snippet === "italic" && "italic",
                )}
                aria-label={name}
                title={name}
                onClick={() => apply(snippet)}
              >
                {text}
              </Button>
            ))}
          </div>
        )}
      </div>
      <TravelTextarea
        {...rest}
        ref={textarea}
        hidden={previewing}
        value={value}
        aria-required={required || undefined}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      {previewing && (
        <div
          className="min-h-22.5 rounded-lg border border-dashed border-travel-control-border bg-travel-surface px-3 py-2.75"
          aria-live="polite"
        >
          <MarkdownPreview source={value} format={format} />
        </div>
      )}
      <FieldDescription className="text-xs text-travel-muted">{HINTS[format]}</FieldDescription>
      <FieldError>{message}</FieldError>
    </Field>
  );
}
