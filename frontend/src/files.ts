import { formatNumber } from "./locale";
import { FeedbackError } from "./query/feedback";
import { m } from "./paraglide/messages.js";

export function bytesLabel(bytes: number): string {
  return bytes < 1024
    ? `${formatNumber(bytes)} B`
    : `${formatNumber(bytes / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kB`;
}

// Types a browser shows without running anything from the file.
const DISPLAYED_INLINE =
  /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm)|application\/pdf|text\/plain)(;|$)/i;

export function openBlobInNewTab(blob: Blob): void {
  // A private file shares the app's origin once opened as a blob, so anything that could run (HTML, SVG, scripts)
  // is handed over as an untyped download instead of being rendered.
  const shown = DISPLAYED_INLINE.test(blob.type)
    ? blob
    : new Blob([blob], { type: "application/octet-stream" });
  const objectUrl = URL.createObjectURL(shown);
  const preview = window.open(objectUrl, "_blank", "noopener");
  if (!preview) {
    URL.revokeObjectURL(objectUrl);
    throw new FeedbackError(() => m.feedback_your_browser_blocked_opening_the_file());
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
