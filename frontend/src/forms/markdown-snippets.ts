import { m } from "../paraglide/messages.js";
/** The toolbar's Markdown snippets. They only insert source text: the server renders it. */
export type MarkdownSnippet = "bold" | "italic" | "heading" | "list" | "tasks" | "link";

export type MarkdownEdit = { value: string; selectionStart: number; selectionEnd: number };

const WRAP: Partial<Record<MarkdownSnippet, { marker: string; placeholder: string }>> = {
  bold: {
    marker: "**",
    get placeholder() {
      return m.owner_snippet_bold();
    },
  },
  italic: {
    marker: "*",
    get placeholder() {
      return m.owner_snippet_italic();
    },
  },
};

const LINE_PREFIX: Partial<Record<MarkdownSnippet, { prefix: string; placeholder: string }>> = {
  heading: {
    prefix: "## ",
    get placeholder() {
      return m.owner_heading();
    },
  },
  list: {
    prefix: "- ",
    get placeholder() {
      return m.owner_item();
    },
  },
  tasks: {
    prefix: "- [ ] ",
    get placeholder() {
      return m.owner_task_2();
    },
  },
};

/**
 * Applies one toolbar snippet to the textarea's value and selection. Bold and italic wrap the
 * selection (or a placeholder) and select the wrapped text; heading, list and task list prefix every
 * selected line (or the cursor's line); a link turns the selection into its text, and a selected
 * address into its target, then selects the part still to fill in.
 */
export function applyMarkdownSnippet(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  snippet: MarkdownSnippet,
): MarkdownEdit {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length));
  const end = Math.min(value.length, Math.max(selectionStart, selectionEnd));
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const wrap = WRAP[snippet];
  if (wrap) {
    const inner = selected || wrap.placeholder;
    const at = start + wrap.marker.length;
    return {
      value: `${before}${wrap.marker}${inner}${wrap.marker}${after}`,
      selectionStart: at,
      selectionEnd: at + inner.length,
    };
  }

  const line = LINE_PREFIX[snippet];
  if (line) {
    const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
    // A selection that ends just after a line break does not reach into the next line.
    const nextBreak = value.indexOf("\n", end > start && value[end - 1] === "\n" ? end - 1 : end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    if (lines.length === 1 && !lines[0].trim()) {
      const text = `${line.prefix}${line.placeholder}`;
      const at = lineStart + line.prefix.length;
      return {
        value: `${value.slice(0, lineStart)}${text}${value.slice(lineEnd)}`,
        selectionStart: at,
        selectionEnd: at + line.placeholder.length,
      };
    }
    const block = lines.map((text) => (text.trim() ? `${line.prefix}${text}` : text)).join("\n");
    return {
      value: `${value.slice(0, lineStart)}${block}${value.slice(lineEnd)}`,
      selectionStart: lineStart,
      selectionEnd: lineStart + block.length,
    };
  }

  // A link: a selected address becomes the target, any other selection the link text.
  const address = /^(https?:\/\/|mailto:)\S+$/.test(selected.trim());
  const text = address ? m.owner_snippet_link() : selected || m.owner_snippet_link();
  const url = address ? selected.trim() : "https://";
  const inserted = `[${text}](${url})`;
  const selectText = address || !selected;
  const at = selectText ? start + 1 : start + text.length + 3;
  return {
    value: `${before}${inserted}${after}`,
    selectionStart: at,
    selectionEnd: at + (selectText ? text.length : url.length),
  };
}
