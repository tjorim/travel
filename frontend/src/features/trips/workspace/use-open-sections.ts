import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { RecordFocus } from "../records/record-focus";
import { resolvePart, type PartAlias } from "./workspace-sections";

type PartLike = { id: string; records: readonly string[]; aliases?: readonly PartAlias[] };

/**
 * Which blocks of a tab are expanded. Only the first starts open. A block opens, and scrolls into view, when the
 * URL hash or the jump search names it, or when a record it hosts is asked to open its dialog. Blocks stay mounted
 * while collapsed (see `SectionAccordion`), so drafts and dialogs survive collapsing. An address that names a block
 * which was merged into another (`#stays`) opens that block and reports the alias, so the block can show what the
 * old one listed.
 */
export function useOpenSections(
  parts: readonly PartLike[],
  recordFocus: RecordFocus | null = null,
  onAlias?: (alias: PartAlias) => void,
) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(parts.map((part, index) => [part.id, index === 0])),
  );
  const hash = useLocation({ select: (location) => location.hash });
  const jump = useLocation({ select: (location) => location.state.openSection });
  const target = jump?.id ?? hash;
  const focusKind = recordFocus?.kind;
  const focusToken = recordFocus?.token;

  const reveal = (id: string | undefined, followAlias = false) => {
    const found = resolvePart(parts, id);
    if (!found) return undefined;
    const partId = found.part.id;
    setOpen((current) => ({ ...current, [partId]: true }));
    if (followAlias && found.alias) onAlias?.(found.alias);
    // The block expands on the next render; scroll once it has its full height.
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(partId);
      element?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      (
        element?.querySelector<HTMLElement>("[data-section-focus]") ??
        element?.querySelector<HTMLButtonElement>("button")
      )?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  };

  useEffect(() => reveal(target, true), [target, jump?.token]);
  useEffect(() => {
    const part = parts.find((candidate) => focusKind && candidate.records.includes(focusKind));
    return reveal(part?.id);
  }, [focusKind, focusToken]);

  return {
    isOpen: (id: string) => open[id] ?? false,
    setOpen: (id: string, value: boolean) => setOpen((current) => ({ ...current, [id]: value })),
  };
}
