/**
 * A long-form text field written in Markdown. The server renders it and sanitizes the HTML against a
 * small allowlist (`backend/app/markdown.py`), so it is injected as-is here: no second renderer or
 * sanitizer runs in the browser. Without rendered HTML, for example from an older cached copy, the
 * source is shown as plain text.
 */
export function Markdown({ html, text, className }: { html?: string | null; text: string | null | undefined; className?: string }) {
  if (!text?.trim()) return null;
  if (!html) return <p className={["markdown-source", className].filter(Boolean).join(" ")}>{text}</p>;
  // Safe: sanitized by the server's allowlist (nh3) before it ever reaches a client.
  return <div className={["markdown", className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: html }} />;
}
