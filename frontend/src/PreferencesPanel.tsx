import type { ReactNode } from "react";
import { PopoverContent } from "@/ui/popover";
import { AppearanceControl } from "./appearance";
import { LocaleControl } from "./locale";

/** Shared popover surface for visitor preferences and the owner's Account controls. */
export function PreferencesPanel({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <PopoverContent
      aria-label={label}
      align="end"
      sideOffset={8}
      className="grid w-travel-preferences-popup gap-3"
    >
      <LocaleControl />
      <AppearanceControl />
      {children}
    </PopoverContent>
  );
}
