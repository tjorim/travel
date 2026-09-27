import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

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
      <main className="shell owner-shell">
        <header>
          <p className="eyebrow">Travel · privé standaard</p>
          <h1>Jouw route, bewust gedeeld.</h1>
          <p className="lede">Deze app houdt het bestaande reisarchief apart. Je account is persoonlijk en wordt nooit op publieke reizen getoond.</p>
          <button type="button" onClick={signIn}>Aanmelden</button>
        </header>
        {children}
      </main>
    );
  }

  return (
    <main className="shell owner-shell owner-shell-authenticated">
      <header className="app-header">
        <nav className="app-nav" aria-label="App navigatie">
          {navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
        </nav>
        <details className="account-menu">
          <summary aria-haspopup="menu">Account</summary>
          <div className="account-menu-panel" role="menu">
            <p><strong>Aangemeld</strong></p>
            <p className="help">Je toegangstoken blijft alleen voor deze browsersessie bewaard.</p>
            <button className="secondary" type="button" role="menuitem" onClick={() => void signOut()}>Afmelden</button>
          </div>
        </details>
      </header>
      {children}
    </main>
  );
}
