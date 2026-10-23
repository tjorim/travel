import { m } from "../paraglide/messages.js";
import { useLocale } from "../locale";
import { textNotice, errorNotice, noticeMessage, type ErrorNotice } from "../query/feedback";
import { Button } from "@/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/ui/field";
import { TravelTextarea } from "@/ui/TravelTextarea";
import type { AnyFieldApi } from "@tanstack/react-form";
import { cn } from "cn";
import { useEffect, useRef, useState, type TextareaHTMLAttributes } from "react";

import { Markdown } from "../Markdown";
import { ownerRequest } from "../query/api";
import { useOwner } from "../query/owner-queries";
import { optionalNote, useFieldErrors } from "./fields";
import { applyMarkdownSnippet, type MarkdownSnippet } from "./markdown-snippets";
import { TranslationDraft } from "./TranslationDraft";

/** How the server renders the field: long-form Markdown, an inline-only caption, or contact details. */
export type MarkdownFormat = "markdown" | "inline" | "contact";

const SNIPPETS: Record<
  MarkdownFormat,
  { snippet: MarkdownSnippet; label: string; text: string }[]
> = {
  markdown: [
    {
      snippet: "bold",
      get label() {
        return m.owner_bold();
      },
      text: "B",
    },
    {
      snippet: "italic",
      get label() {
        return m.owner_italic();
      },
      text: "I",
    },
    {
      snippet: "heading",
      get label() {
        return m.owner_heading();
      },
      text: "H",
    },
    {
      snippet: "list",
      get label() {
        return m.owner_list();
      },
      text: "•",
    },
    {
      snippet: "tasks",
      get label() {
        return m.owner_task_list();
      },
      text: "☐",
    },
    {
      snippet: "link",
      get label() {
        return m.owner_link();
      },
      get text() {
        return m.owner_link();
      },
    },
  ],
  inline: [
    {
      snippet: "bold",
      get label() {
        return m.owner_bold();
      },
      text: "B",
    },
    {
      snippet: "italic",
      get label() {
        return m.owner_italic();
      },
      text: "I",
    },
    {
      snippet: "link",
      get label() {
        return m.owner_link();
      },
      get text() {
        return m.owner_link();
      },
    },
  ],
  contact: [],
};

const HINTS: Record<MarkdownFormat, string> = {
  get markdown() {
    return m.owner_markdown_bold_italic_headings_lists_task_lists_links_and_tables();
  },
  get inline() {
    return m.owner_only_bold_italic_and_links();
  },
  get contact() {
    return m.owner_plain_text_phone_numbers_email_addresses_and_web_addresses_become_links();
  },
};

type RenderResult = { html: string | null; text: string | null };

/**
 * The server's rendering of the current text: the same renderer as the stored field, so the preview
 * and what visitors see never drift apart.
 */
function MarkdownPreview({ source, format }: { source: string; format: MarkdownFormat }) {
  useLocale();
  const owner = useOwner();
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; result: RenderResult }
    | { kind: "error"; message: string | ErrorNotice | import("../query/feedback").MessageNotice }
  >({ kind: "loading" });

  useEffect(() => {
    if (!owner) {
      setState({ kind: "error", message: textNotice(m.owner_sign_in_to_see_a_preview) });
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    ownerRequest<RenderResult>(
      owner.session,
      "/api/markdown/render",
      m.owner_the_preview_could_not_be_loaded,
      {
        method: "POST",
        body: { source, format },
        signal: controller.signal,
      },
    )
      .then((result) => setState({ kind: "ready", result }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            kind: "error",
            message: errorNotice(error, m.owner_the_preview_could_not_be_loaded),
          });
      });
    return () => controller.abort();
  }, [owner, source, format]);

  if (state.kind === "loading")
    return (
      <p className="help" role="status">
        {m.owner_loading_preview()}
      </p>
    );
  if (state.kind === "error")
    return (
      <p className="form-error" role="alert">
        {noticeMessage(state.message)}
      </p>
    );
  if (!state.result.html) return <p className="help">{m.owner_nothing_to_show_yet()}</p>;
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
}: {
  field: AnyFieldApi;
  label: string;
  optional?: string | boolean;
  format?: MarkdownFormat;
} & Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange" | "onBlur" | "name" | "id"
>) {
  useLocale();
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
    <>
      <Field name={field.name} invalid={invalid}>
        <FieldLabel>
          <span>
            {label}
            {optionalNote(optional)}
          </span>
        </FieldLabel>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={m.owner_view_for({ p0: label })}
          >
            <Button
              type="button"
              className="compact aria-[pressed=false]:bg-transparent aria-[pressed=false]:text-travel-forest aria-[pressed=false]:ring-1 aria-[pressed=false]:ring-travel-control-border"
              aria-pressed={!previewing}
              onClick={() => setPreviewing(false)}
            >
              {m.owner_write()}
            </Button>
            <Button
              type="button"
              className="compact aria-[pressed=false]:bg-transparent aria-[pressed=false]:text-travel-forest aria-[pressed=false]:ring-1 aria-[pressed=false]:ring-travel-control-border"
              aria-pressed={previewing}
              onClick={() => setPreviewing(true)}
            >
              {m.owner_preview()}
            </Button>
          </div>
          {!previewing && SNIPPETS[format].length > 0 && (
            <div
              className="flex flex-wrap gap-1"
              role="toolbar"
              aria-label={m.owner_formatting_for({ p0: label })}
            >
              {SNIPPETS[format].map(({ snippet, label: name, text }) => (
                <Button
                  key={snippet}
                  type="button"
                  className={cn(
                    "compact secondary min-w-9 max-[679px]:min-w-11",
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
      {format === "markdown" && (
        <TranslationDraft
          label={label}
          value={value}
          onAppend={(draft) =>
            field.handleChange(value.trim() ? `${value.replace(/\s+$/, "")}\n\n${draft}` : draft)
          }
        />
      )}
    </>
  );
}
