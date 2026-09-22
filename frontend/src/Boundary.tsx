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

  function signIn() {
    void beginSignIn(window.location.pathname.replace(/^\/admin(?=\/|$)/, "") || "/");
  }

  async function signOut() {
    if (!session) return;
    const subject = decodeSubject(session.accessToken);
    if (subject) await wipeOfflineData(subject).catch(() => undefined);
    beginSignOut(session);
  }

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Travel · privé standaard</p>
        <h1>Jouw route, bewust gedeeld.</h1>
        <p className="lede">Deze app houdt het bestaande reisarchief apart. Je account is persoonlijk en wordt nooit op publieke reizen getoond.</p>
      </header>
      <section className="notice" aria-label="Aanmeldstatus">
        <strong>{session ? "Aangemeld" : "Nog niet aangemeld"}</strong>
        <span>{session ? "Je toegangstoken blijft alleen voor deze browsersessie bewaard." : "Meld aan om je private reizen te zien of te wijzigen."}</span>
        {session ? <button className="secondary" type="button" onClick={() => void signOut()}>Afmelden</button> : <button type="button" onClick={signIn}>Aanmelden</button>}
      </section>
      {children}
      <nav aria-label="App navigatie">
        {navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
      </nav>
    </main>
  );
}
