import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
import { Preferences } from "./Preferences";
import { Button } from "@base-ui/react/button";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { HouseIcon, LibraryIcon, MapPinIcon, PlusIcon, SettingsIcon } from "lucide-react";

import { beginSignIn, beginSignOut, decodeSubject } from "./auth";
import { useAuth } from "./auth-context";
import { CaptureProvider, useCapture } from "./capture-context";
import { wipeOfflineData } from "./offline/offline-store";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * Capture is an action, not a place, so it is a button that is always at hand rather than a nav item. Inside a trip it
 * opens locked to that trip, so the owner is never asked which trip they meant.
 */
function CaptureButton() {
  useLocale();
  const openCapture = useCapture();
  const tripId = useRouterState({
    select: (state) => (state.matches.at(-1)?.params as { tripId?: string } | undefined)?.tripId,
  });
  return (
    <Button
      className="max-[679px]:fixed max-[679px]:right-4 max-[679px]:bottom-20 max-[679px]:z-30 max-[679px]:rounded-full max-[679px]:shadow-travel-card inline-flex items-center gap-1.5"
      type="button"
      aria-label={tripId ? m.owner_capture_in_trip() : undefined}
      onClick={() => openCapture({ tripId })}
    >
      <PlusIcon className="size-4" aria-hidden="true" />
      {m.capture()}
    </Button>
  );
}

export function Boundary({ children }: { children: ReactNode }) {
  useLocale();
  const navigation = [
    ["/", m.overview(), HouseIcon],
    ["/trips", m.trips(), MapPinIcon],
    ["/library", m.library(), LibraryIcon],
    ["/settings", m.settings(), SettingsIcon],
  ] as const;

  const { session } = useAuth();
  const queryClient = useQueryClient();

  function signIn() {
    void beginSignIn(window.location.pathname.replace(/^\/admin(?=\/|$)/, "") || "/");
  }

  async function signOut() {
    if (!session) return;
    const subject = decodeSubject(session.accessToken);
    if (subject) await wipeOfflineData(subject).catch(() => undefined);
    queryClient.clear();
    beginSignOut(session);
  }

  if (!session) {
    return (
      <main className="travel-shell pt-6! min-[960px]:w-travel-owner-shell [&>header]:max-w-180">
        <Preferences />
        <header>
          <p className="travel-eyebrow">{m.private_default()}</p>
          <h1>{m.welcome()}</h1>
          <p className="max-w-145 leading-relaxed text-travel-muted">{m.welcome_description()}</p>
          <Button type="button" onClick={signIn}>
            {m.sign_in()}
          </Button>
        </header>
        {children}
      </main>
    );
  }

  return (
    <CaptureProvider>
      <main className="travel-shell pt-6! min-[960px]:w-travel-owner-shell">
        <Preferences />
        <header className="mb-6 flex items-center justify-between gap-4">
          <nav
            className="fixed inset-x-0 bottom-0 z-20 flex justify-between border-t border-travel-card-border bg-travel-surface/95 px-1 backdrop-blur-md min-[680px]:static min-[680px]:z-auto min-[680px]:mt-7 min-[680px]:justify-start min-[680px]:gap-10 min-[680px]:border-0 min-[680px]:bg-transparent min-[680px]:p-0 min-[680px]:backdrop-blur-none"
            aria-label={m.navigation()}
          >
            {navigation.map(([to, label, Icon]) => (
              <Link
                className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-xs font-bold text-travel-muted no-underline aria-[current=page]:text-travel-forest min-[680px]:min-h-0 min-[680px]:flex-none min-[680px]:text-sm"
                key={to}
                to={to}
                activeOptions={{ exact: to === "/", includeSearch: false }}
              >
                <Icon className="size-5 min-[680px]:hidden" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <CaptureButton />
            <Popover>
              <PopoverTrigger className="rounded-lg border border-travel-control-border bg-transparent px-3.5 py-2.25 font-bold text-travel-forest">
                {m.account()}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={8}
                className="grid w-60 gap-1 rounded-xl border-travel-card-border bg-travel-surface p-3.5 text-travel-muted"
              >
                <p className="m-0">
                  <strong className="text-travel-ink">{m.signed_in()}</strong>
                </p>
                <p className="help">{m.session_notice()}</p>
                <Button
                  className="secondary mt-2 w-full"
                  type="button"
                  onClick={() => void signOut()}
                >
                  {m.sign_out()}
                </Button>
              </PopoverContent>
            </Popover>
          </div>
        </header>
        {children}
      </main>
    </CaptureProvider>
  );
}
