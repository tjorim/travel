import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { RecordFocus } from "./record-focus";

type PartLike = { id: string; records: readonly string[] };

/**
 * Which blocks of a tab are expanded. Only the first starts open. A block opens, and scrolls into view, when the
 * URL hash or the jump search names it, or when a record it hosts is asked to open its dialog. Blocks stay mounted
 * while collapsed (see `SectionAccordion`), so drafts and dialogs survive collapsing.
 */
export function useOpenSections(
  parts: readonly PartLike[],
  recordFocus: RecordFocus | null = null,
) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(parts.map((part, index) => [part.id, index === 0])),
  );
  const hash = useLocation({ select: (location) => location.hash });
  const jump = useLocation({ select: (location) => location.state.openSection });
  const target = jump?.id ?? hash;
  const focusKind = recordFocus?.kind;
  const focusToken = recordFocus?.token;

  const reveal = (id: string | undefined) => {
    if (!id || !parts.some((part) => part.id === id)) return undefined;
    setOpen((current) => ({ ...current, [id]: true }));
    // The block expands on the next render; scroll once it has its full height.
    const frame = requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView?.({ behavior: "smooth", block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  };

  useEffect(() => reveal(target), [target, jump?.token]);
  useEffect(() => {
    const part = parts.find((candidate) => focusKind && candidate.records.includes(focusKind));
    return reveal(part?.id);
  }, [focusKind, focusToken]);

  return {
    isOpen: (id: string) => open[id] ?? false,
    setOpen: (id: string, value: boolean) => setOpen((current) => ({ ...current, [id]: value })),
  };
}
