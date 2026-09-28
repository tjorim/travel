import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { beginSignIn, beginSignOut, decodeSubject } from "./auth";
import { useAuth } from "./auth-context";
import { wipeOfflineData } from "./offline/offline-store";

const navigation = [
  ["/", "Overzicht"],
  ["/trips", "Reizen"],
  ["/capture", "Vastleggen"],
  ["/library", "Bibliotheek"],
  ["/settings", "Instellingen"],
] as const;

export function Boundary({ children }: { children: ReactNode }) {
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
      <main className="travel-shell min-[960px]:w-travel-owner-shell [&>header]:max-w-180">
        <header>
          <p className="travel-eyebrow">Travel · privé standaard</p>
          <h1>Jouw route, bewust gedeeld.</h1>
          <p className="max-w-145 leading-relaxed text-travel-muted">
            Deze app houdt het bestaande reisarchief apart. Je account is persoonlijk en wordt nooit op publieke reizen
            getoond.
          </p>
          <Button type="button" onClick={signIn}>
            Aanmelden
          </Button>
        </header>
        {children}
      </main>
    );
  }

  return (
    <main className="travel-shell pt-6! min-[960px]:w-travel-owner-shell [&>header]:max-w-180">
      <header className="mb-6 flex items-center justify-between gap-4">
        <nav
          className="fixed inset-x-0 bottom-0 flex justify-between gap-1 border-t border-travel-card-border bg-travel-surface/95 px-2.5 py-3.5 backdrop-blur-md min-[680px]:static min-[680px]:mt-7 min-[680px]:justify-start min-[680px]:gap-10 min-[680px]:border-0 min-[680px]:bg-transparent min-[680px]:p-0 min-[680px]:backdrop-blur-none"
          aria-label="App navigatie"
        >
          {navigation.map(([to, label]) => (
            <Link
              className="whitespace-nowrap text-xs font-bold text-travel-muted no-underline aria-[current=page]:text-travel-forest min-[680px]:text-sm"
              key={to}
              to={to}
              activeOptions={{ exact: to === "/", includeSearch: false }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Collapsible.Root className="relative shrink-0">
          <Collapsible.Trigger
            className="rounded-lg border border-travel-control-border bg-transparent px-3.5 py-2.25 font-bold text-travel-forest"
            aria-haspopup="menu"
          >
            Account
          </Collapsible.Trigger>
          <Collapsible.Panel
            keepMounted
            className="absolute top-full right-0 z-10 mt-2 grid w-full min-w-60 gap-1 rounded-xl border border-travel-card-border bg-travel-surface p-3.5 text-sm text-travel-muted shadow-travel-card max-[679px]:fixed max-[679px]:inset-x-3 max-[679px]:top-auto max-[679px]:bottom-21 max-[679px]:w-auto"
            role="menu"
          >
            <p className="m-0">
              <strong className="text-travel-ink">Aangemeld</strong>
            </p>
            <p className="help">Je toegangstoken blijft alleen voor deze browsersessie bewaard.</p>
            <Button className="secondary mt-2 w-full" type="button" role="menuitem" onClick={() => void signOut()}>
              Afmelden
            </Button>
          </Collapsible.Panel>
        </Collapsible.Root>
      </header>
      {children}
    </main>
  );
}
