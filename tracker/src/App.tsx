import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

const navigation = [
  ["/", "Overzicht"],
  ["/trips", "Reizen"],
  ["/capture", "Vastleggen"],
  ["/settings", "Instellingen"],
] as const;

function Boundary({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Travel tracker · privé standaard</p>
        <h1>Jouw route, bewust gedeeld.</h1>
        <p className="lede">Deze app-shell houdt de bestaande reisarchiefpagina’s apart. Aanmelden volgt pas wanneer de Travel-accountgrens klaar is.</p>
      </header>
      <section className="notice" aria-label="Aanmeldstatus">
        <strong>Nog niet aangemeld</strong>
        <span>De tracker toont nog geen persoonlijke gegevens en slaat geen wijzigingen offline op.</span>
      </section>
      {children}
      <nav aria-label="Tracker navigatie">
        {navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
      </nav>
    </main>
  );
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2>{title}</h2><p>{children}</p></section>;
}

export function App() {
  return (
    <Boundary>
      <Routes>
        <Route path="/" element={<EmptyState title="Nog geen actieve reis">Maak straks een private reis aan en kies later bewust wat je deelt.</EmptyState>} />
        <Route path="/trips" element={<EmptyState title="Reizen">Je private en gedeelde reizen verschijnen hier na aanmelden.</EmptyState>} />
        <Route path="/capture" element={<EmptyState title="Moment vastleggen">Mobiele invoer en locatiekeuzes komen na de eerste account- en privacyflow.</EmptyState>} />
        <Route path="/settings" element={<EmptyState title="Instellingen">Account, zichtbaarheid en installatievoorkeuren blijven hier bij elkaar.</EmptyState>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Boundary>
  );
}
