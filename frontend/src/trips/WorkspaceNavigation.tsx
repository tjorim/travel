import { useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/ui/dialog";
import { useLocale } from "../locale";
import { m } from "../paraglide/messages.js";
import { WorkspaceTabs } from "./WorkspaceTabs";
import type { TripWorkspaceSection } from "./workspace-sections";

/** Only navigation changes at the CSS breakpoint. Editors/search/capture never live here. */
export function WorkspaceNavigation({
  tripId,
  current,
}: {
  tripId: string;
  current: TripWorkspaceSection;
}) {
  useLocale();
  const location = useLocation();
  const [wide, setWide] = useState(() => matchMedia("(min-width: 1100px)").matches);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const desktop = useRef<HTMLDivElement>(null);
  const headingFocus = useRef(false);
  const previousLocation = useRef(location.href);
  useEffect(() => {
    const media = matchMedia("(min-width: 1100px)");
    const change = () => {
      setWide(media.matches);
      setOpen(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (previousLocation.current === location.href) return;
    previousLocation.current = location.href;
    if (open) {
      headingFocus.current = true;
      setOpen(false);
    }
  }, [location.href, open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        headingFocus.current = false;
        setOpen(next);
      }}
    >
      <div ref={desktop}>{wide && <WorkspaceTabs tripId={tripId} current={current} />}</div>
      <Dialog.Trigger ref={trigger} className="secondary min-h-11 trip-sidebar:hidden">
        {m.owner_trip_sections()}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-travel-backdrop/50" />
        <Dialog.Popup
          className="fixed inset-y-0 left-0 z-50 box-border w-travel-drawer max-w-full overflow-y-auto overscroll-contain border-r border-travel-border bg-travel-surface p-4 text-travel-ink shadow-2xl"
          finalFocus={() => {
            if (headingFocus.current) {
              headingFocus.current = false;
              return document.getElementById("workspace-section-heading");
            }
            return matchMedia("(min-width: 1100px)").matches
              ? (desktop.current?.querySelector<HTMLAnchorElement>('[aria-current="page"]') ??
                  document.getElementById("workspace-section-heading"))
              : trigger.current;
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Dialog.Title className="m-0 text-lg font-bold">{m.owner_trip_sections()}</Dialog.Title>
            <Dialog.Close className="secondary min-h-11 shrink-0 whitespace-nowrap">
              {m.owner_close_2()}
            </Dialog.Close>
          </div>
          {!wide && (
            <WorkspaceTabs
              tripId={tripId}
              current={current}
              drawer
              onSelect={(event) => {
                // Preserve native copy/new-tab/modifier behavior. Close only after a successful route change.
                if (
                  event.button ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                if (event.currentTarget.getAttribute("aria-current") === "page") {
                  headingFocus.current = true;
                  setOpen(false);
                }
              }}
            />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
