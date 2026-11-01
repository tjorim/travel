/**
 * A long-form text field written in Markdown. The server renders it and sanitizes the HTML against a
 * small allowlist (`backend/app/markdown.py`), so it is injected as-is here: no second renderer or
 * sanitizer runs in the browser. Without rendered HTML, for example from an older cached copy, the
 * source is shown as plain text.
 */
/**
 * Moves the headings of rendered Markdown so the first sits one level below the heading it appears under, keeping
 * the author's relative levels, so a `##` in a note never skips a level. The HTML is the server's sanitized output,
 * where headings carry no attributes.
 */
export function fitHeadings(html: string, under: number) {
  const levels = [...html.matchAll(/<h([1-6])>/g)].map((match) => Number(match[1]));
  if (!levels.length) return html;
  const shift = under + 1 - Math.min(...levels);
  return html.replace(/<(\/?)h([1-6])>/g, (_, close: string, level: string) => {
    return `<${close}h${Math.min(6, Math.max(1, Number(level) + shift))}>`;
  });
}

export function Markdown({
  html,
  text,
  className,
  as,
  under,
}: {
  html?: string | null;
  text: string | null | undefined;
  className?: string;
  /** An inline-only field, such as a caption, can render into its own element. */
  as?: "figcaption";
  /** The level of the heading this text sits under; its own headings are fitted below it. */
  under?: number;
}) {
  if (!text?.trim()) return null;
  if (!html) {
    const classes = ["whitespace-pre-line", as === "figcaption" && "leading-normal", className]
      .filter(Boolean)
      .join(" ");
    return as === "figcaption" ? (
      <figcaption className={classes} data-markdown-source="">
        {text}
      </figcaption>
    ) : (
      <p className={classes} data-markdown-source="">
        {text}
      </p>
    );
  }
  const Element = as ?? "div";
  // Safe: sanitized by the server's allowlist (nh3) before it ever reaches a client.
  return (
    <Element
      className={["markdown", className].filter(Boolean).join(" ")}
      dangerouslySetInnerHTML={{ __html: under ? fitHeadings(html, under) : html }}
    />
  );
}
