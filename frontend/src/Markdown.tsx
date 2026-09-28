/**
 * A long-form text field written in Markdown. The server renders it and sanitizes the HTML against a
 * small allowlist (`backend/app/markdown.py`), so it is injected as-is here: no second renderer or
 * sanitizer runs in the browser. Without rendered HTML, for example from an older cached copy, the
 * source is shown as plain text.
 */
export function Markdown({
  html,
  text,
  className,
  as,
}: {
  html?: string | null;
  text: string | null | undefined;
  className?: string;
  /** An inline-only field, such as a caption, can render into its own element. */ as?: "figcaption";
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
    <Element className={["markdown", className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
