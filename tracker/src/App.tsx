import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate, useSearchParams } from "react-router-dom";

import { beginSignIn, beginSignOut, completeSignIn, readSession, type TrackerSession } from "./auth";

const navigation = [
  ["/", "Overzicht"],
  ["/trips", "Reizen"],
  ["/capture", "Vastleggen"],
  ["/settings", "Instellingen"],
] as const;

type AuthContextValue = {
  session: TrackerSession | null;
  setSession: (session: TrackerSession | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("Travel tracker authentication context is missing.");
  return context;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<TrackerSession | null>(() => readSession());
  return <AuthContext.Provider value={{ session, setSession }}>{children}</AuthContext.Provider>;
}

function Boundary({ children }: { children: ReactNode }) {
  const { session } = useAuth();

  function signIn() {
    void beginSignIn(window.location.pathname.replace(/^\/tracker/, "") || "/");
  }

  return (
    <main className="shell">
      <header>
        <p className="eyebrow">Travel tracker · privé standaard</p>
        <h1>Jouw route, bewust gedeeld.</h1>
        <p className="lede">Deze app houdt het bestaande reisarchief apart. Je tracker-account is persoonlijk en wordt nooit op publieke reizen getoond.</p>
      </header>
      <section className="notice" aria-label="Aanmeldstatus">
        <strong>{session ? "Aangemeld" : "Nog niet aangemeld"}</strong>
        <span>{session ? "Je toegangstoken blijft alleen voor deze browsersessie bewaard." : "Meld aan om je private reizen te zien of te wijzigen."}</span>
        {session ? <button className="secondary" type="button" onClick={() => beginSignOut(session)}>Afmelden</button> : <button type="button" onClick={signIn}>Aanmelden</button>}
      </section>
      {children}
      <nav aria-label="Tracker navigatie">
        {navigation.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
      </nav>
    </main>
  );
}

function Callback() {
  const { setSession } = useAuth();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("Aanmelden wordt afgerond…");

  useEffect(() => {
    void completeSignIn(search.toString())
      .then(({ returnPath, session }) => {
        setSession(session);
        navigate(returnPath, { replace: true });
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Aanmelden is mislukt."));
  }, [navigate, search, setSession]);

  return <main className="shell"><section className="card"><h1>Aanmelden</h1><p>{message}</p></section></main>;
}

function Trips() {
  const { session } = useAuth();
  const [message, setMessage] = useState("Meld aan om je private reizen te laden.");

  useEffect(() => {
    if (!session) return;
    void fetch("/api/v1/trips", { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.ok ? response.json() as Promise<unknown[]> : Promise.reject(new Error("Je sessie is niet meer geldig.")))
      .then((trips) => setMessage(trips.length === 0 ? "Nog geen reizen. Maak straks je eerste private reis aan." : `${trips.length} reizen geladen.`))
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je reizen konden niet worden geladen."));
  }, [session]);

  return <EmptyState title="Reizen">{message}</EmptyState>;
}

function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><h2>{title}</h2><p>{children}</p></section>;
}

function Tracker() {
  return (
    <Boundary>
      <Routes>
        <Route path="/" element={<EmptyState title="Nog geen actieve reis">Maak straks een private reis aan en kies later bewust wat je deelt.</EmptyState>} />
        <Route path="/trips" element={<Trips />} />
        <Route path="/capture" element={<EmptyState title="Moment vastleggen">Mobiele invoer en locatiekeuzes komen na de eerste account- en privacyflow.</EmptyState>} />
        <Route path="/settings" element={<EmptyState title="Instellingen">Account, zichtbaarheid en installatievoorkeuren blijven hier bij elkaar.</EmptyState>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Boundary>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/auth/callback" element={<Callback />} />
        <Route path="*" element={<Tracker />} />
      </Routes>
    </AuthProvider>
  );
}
