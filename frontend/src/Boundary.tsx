import { m } from "./paraglide/messages.js";
import { useLocale } from "./locale";
import { Preferences } from "./Preferences";
import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CameraIcon, HouseIcon, LibraryIcon, MapPinIcon, SettingsIcon } from "lucide-react";

import { beginSignIn, beginSignOut, decodeSubject } from "./auth";
import { useAuth } from "./auth-context";
import { wipeOfflineData } from "./offline/offline-store";

export function Boundary({ children }: { children: ReactNode }) {
  useLocale();
  const navigation = [
    ["/", m.overview(), HouseIcon],
    ["/trips", m.trips(), MapPinIcon],
    ["/capture", m.capture(), CameraIcon],
    ["/library", m.library(), LibraryIcon],
    ["/settings", m.settings(), SettingsIcon],
  ] as const;

  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);

  // The account menu is a popup, not a section: Escape or a click elsewhere closes it, and Escape returns focus.
  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        accountTrigger.current?.focus();
      } else if (accountRef.current?.contains(event.target as Node)) return;
      setAccountOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, [accountOpen]);

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
        <Collapsible.Root
          className="relative ml-auto shrink-0"
          open={accountOpen}
          onOpenChange={setAccountOpen}
          ref={accountRef}
        >
          <Collapsible.Trigger
            ref={accountTrigger}
            className="rounded-lg border border-travel-control-border bg-transparent px-3.5 py-2.25 font-bold text-travel-forest"
            aria-haspopup="menu"
          >
            {m.account()}
          </Collapsible.Trigger>
          <Collapsible.Panel
            keepMounted
            className="absolute top-full right-0 z-10 mt-2 grid w-full min-w-60 gap-1 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 text-sm text-travel-muted shadow-travel-card max-[679px]:fixed max-[679px]:inset-x-3 max-[679px]:top-auto max-[679px]:bottom-21 max-[679px]:w-auto"
            role="menu"
          >
            <p className="m-0">
              <strong className="text-travel-ink">{m.signed_in()}</strong>
            </p>
            <p className="help">{m.session_notice()}</p>
            <Button className="secondary mt-2 w-full" type="button" role="menuitem" onClick={() => void signOut()}>
              {m.sign_out()}
            </Button>
          </Collapsible.Panel>
        </Collapsible.Root>
      </header>
      {children}
    </main>
  );
}
