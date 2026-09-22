import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
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

type Place = {
  id: string;
  display_name: string;
  country_code: string | null;
};

type Moment = {
  id: string;
  occurred_at: string;
  title: string;
  story: string;
  place: Place | null;
};

type Trip = {
  id: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  publication_state: "draft" | "published";
  moments: Moment[];
};

type LocationPrecision = "none" | "country" | "region" | "city";

type MomentDraft = {
  tripId: string;
  momentId: string | null;
  occurredAt: string;
  title: string;
  story: string;
  precision: LocationPrecision;
  placeName: string;
  countryCode: string;
};

const draftKey = "travel-tracker-moment-draft-v1";

function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function emptyDraft(tripId = ""): MomentDraft {
  return { tripId, momentId: null, occurredAt: localDateTime(), title: "", story: "", precision: "none", placeName: "", countryCode: "" };
}

function readDraft(): MomentDraft | null {
  try {
    const value = localStorage.getItem(draftKey);
    if (!value) return null;
    const draft = JSON.parse(value) as Partial<MomentDraft>;
    if (typeof draft.tripId !== "string" || typeof draft.occurredAt !== "string" || typeof draft.title !== "string" || typeof draft.story !== "string") return null;
    return { ...emptyDraft(draft.tripId), ...draft, momentId: typeof draft.momentId === "string" ? draft.momentId : null };
  } catch {
    return null;
  }
}

function publicationDescription(trip: Trip): string {
  if (trip.publication_state !== "published" || trip.visibility === "private") return "Privé concept — dit moment is nergens publiek zichtbaar.";
  return trip.visibility === "public" ? "Publieke reis — dit moment wordt na opslaan publiek zichtbaar." : "Verborgen link — dit moment wordt na opslaan via de reislink zichtbaar.";
}

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

function Capture() {
  const { session } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState(navigator.onLine);
  const [draft, setDraft] = useState<MomentDraft>(() => readDraft() ?? emptyDraft());
  const [draftState, setDraftState] = useState(readDraft() ? "Lokaal concept hersteld." : "Nieuw concept.");
  const [saveState, setSaveState] = useState("");
  const [geoState, setGeoState] = useState("");

  useEffect(() => {
    const updateConnection = () => setConnection(navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetch("/api/v1/trips", { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.ok ? response.json() as Promise<Trip[]> : Promise.reject(new Error("Je sessie is niet meer geldig.")))
      .then((loadedTrips) => {
        setTrips(loadedTrips);
        setDraft((current) => current.tripId || loadedTrips.length === 0 ? current : { ...current, tripId: loadedTrips[0].id });
      })
      .catch((error: unknown) => setSaveState(error instanceof Error ? error.message : "Je reizen konden niet worden geladen."))
      .finally(() => setLoading(false));
  }, [session]);

  useEffect(() => {
    if (!draft.momentId && !draft.title && !draft.story) {
      localStorage.removeItem(draftKey);
      return;
    }
    localStorage.setItem(draftKey, JSON.stringify(draft));
    setDraftState("Concept lokaal bewaard — nog niet naar je reis gestuurd.");
  }, [draft]);

  const selectedTrip = useMemo(() => trips.find((trip) => trip.id === draft.tripId) ?? null, [draft.tripId, trips]);

  function updateDraft(values: Partial<MomentDraft>) {
    setDraft((current) => ({ ...current, ...values }));
    setSaveState("");
  }

  function startNew() {
    const next = emptyDraft(selectedTrip?.id ?? trips[0]?.id ?? "");
    setDraft(next);
    setGeoState("");
    setSaveState("");
  }

  function editMoment(moment: Moment) {
    const occurred = new Date(moment.occurred_at);
    setDraft({
      tripId: selectedTrip?.id ?? "",
      momentId: moment.id,
      occurredAt: localDateTime(occurred),
      title: moment.title,
      story: moment.story,
      precision: moment.place ? "city" : "none",
      placeName: moment.place?.display_name ?? "",
      countryCode: moment.place?.country_code ?? "",
    });
    setGeoState("");
    setSaveState("Je bewerkt een opgeslagen moment.");
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setGeoState("Deze browser ondersteunt geen eenmalige locatietoegang.");
      return;
    }
    setGeoState("Je browser vraagt nu eenmalig om je locatie…");
    navigator.geolocation.getCurrentPosition(
      () => setGeoState("Locatie eenmalig ontvangen en direct verworpen. Kies hieronder zelf een brede plaatsnaam; er worden geen coördinaten opgeslagen of verstuurd."),
      (error) => setGeoState(error.code === error.PERMISSION_DENIED ? "Locatietoegang is niet toegestaan. Je kunt een plaatsnaam zelf invullen of weglaten." : "Je locatie kon niet worden bepaald. Je kunt een plaatsnaam zelf invullen of weglaten."),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 10_000 },
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) {
      setSaveState("Kies eerst een reis en meld aan om op te slaan.");
      return;
    }
    if (!connection) {
      setSaveState("Je bent offline. Dit concept blijft alleen lokaal bewaard en wordt niet automatisch verstuurd.");
      return;
    }
    const name = draft.placeName.trim();
    const country = draft.countryCode.trim().toUpperCase();
    if (draft.precision !== "none" && !name) {
      setSaveState("Vul een brede plaatsnaam in of kies ‘geen locatie’.");
      return;
    }
    if (country && !/^[A-Z]{2}$/.test(country)) {
      setSaveState("Gebruik voor land optioneel een ISO-code van twee hoofdletters, bijvoorbeeld TW.");
      return;
    }
    const payload = {
      occurred_at: new Date(draft.occurredAt).toISOString(),
      title: draft.title.trim(),
      story: draft.story.trim(),
      place: draft.precision === "none" ? null : { display_name: name, ...(country ? { country_code: country } : {}) },
    };
    setSaveState("Opslaan…");
    try {
      const endpoint = draft.momentId ? `/api/v1/trips/${selectedTrip.id}/moments/${draft.momentId}` : `/api/v1/trips/${selectedTrip.id}/moments`;
      const response = await fetch(endpoint, {
        method: draft.momentId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Het moment kon niet worden opgeslagen. Je lokale concept blijft bewaard.");
      const saved = await response.json() as Moment;
      setTrips((current) => current.map((trip) => trip.id !== selectedTrip.id ? trip : {
        ...trip,
        moments: draft.momentId ? trip.moments.map((item) => item.id === saved.id ? saved : item) : [...trip.moments, saved],
      }));
      localStorage.removeItem(draftKey);
      setDraftState("Opgeslagen in je private reis.");
      setSaveState("Moment opgeslagen.");
      setDraft(emptyDraft(selectedTrip.id));
      setGeoState("");
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : "Het moment kon niet worden opgeslagen. Je lokale concept blijft bewaard.");
    }
  }

  if (!session) return <EmptyState title="Moment vastleggen">Meld aan om een concept lokaal te bewaren of een moment aan een private reis toe te voegen.</EmptyState>;
  if (loading) return <EmptyState title="Moment vastleggen">Je reizen laden…</EmptyState>;
  if (trips.length === 0) return <EmptyState title="Moment vastleggen">Maak eerst een private reis aan; daarna kun je hier een moment aan toevoegen.</EmptyState>;

  return (
    <section className="capture" aria-labelledby="capture-title">
      <div className="capture-heading">
        <div><p className="eyebrow">Mobiel vastleggen</p><h2 id="capture-title">{draft.momentId ? "Moment bewerken" : "Nieuw moment"}</h2></div>
        {draft.momentId && <button className="secondary compact" type="button" onClick={startNew}>Nieuw moment</button>}
      </div>
      <p className={`connection ${connection ? "online" : "offline"}`} role="status">{connection ? "Verbonden — je kiest zelf wanneer je opslaat." : "Offline — concepten blijven lokaal; er is geen automatische synchronisatie."}</p>
      <form className="capture-form" onSubmit={save}>
        <label>Reis<select value={draft.tripId} onChange={(event) => updateDraft({ tripId: event.target.value, momentId: null })}>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
        {selectedTrip && <aside className="publication" aria-label="Zichtbaarheid van dit moment"><strong>Voor je opslaat</strong><span>{publicationDescription(selectedTrip)}</span></aside>}
        <div className="field-row"><label>Datum en tijd<input required type="datetime-local" value={draft.occurredAt} onChange={(event) => updateDraft({ occurredAt: event.target.value })} /></label><label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Bijvoorbeeld: eerste avond" /></label></div>
        <label>Je moment<textarea required maxLength={10000} rows={6} value={draft.story} onChange={(event) => updateDraft({ story: event.target.value })} placeholder="Wat wil je onthouden?" /></label>
        <fieldset className="location"><legend>Locatie — volledig optioneel</legend><p>Travel bewaart alleen de tekst die je hieronder kiest, nooit gps-coördinaten of locatiegeschiedenis.</p><button className="secondary" type="button" onClick={useCurrentLocation}>Gebruik mijn locatie, één keer</button>{geoState && <p className="help" role="status">{geoState}</p>}
          <label>Hoe precies wil je dit bewaren?<select value={draft.precision} onChange={(event) => { const precision = event.target.value as LocationPrecision; updateDraft({ precision, ...(precision === "none" ? { placeName: "", countryCode: "" } : {}) }); }}><option value="none">Geen locatie</option><option value="country">Alleen land</option><option value="region">Regio of eiland</option><option value="city">Stad of brede plaats</option></select></label>
          {draft.precision !== "none" && <div className="field-row"><label>Brede plaatsnaam<input required maxLength={120} value={draft.placeName} onChange={(event) => updateDraft({ placeName: event.target.value })} placeholder={draft.precision === "country" ? "Bijvoorbeeld: Taiwan" : draft.precision === "region" ? "Bijvoorbeeld: Noord-Taiwan" : "Bijvoorbeeld: Taipei"} /></label><label>Landcode <span className="optional">optioneel</span><input maxLength={2} value={draft.countryCode} onChange={(event) => updateDraft({ countryCode: event.target.value.toUpperCase() })} placeholder="TW" /></label></div>}
        </fieldset>
        <div className="save-row"><button type="submit">{draft.momentId ? "Wijzigingen opslaan" : "Moment opslaan"}</button><span aria-live="polite">{saveState || draftState}</span></div>
      </form>
      {selectedTrip && selectedTrip.moments.length > 0 && <section className="saved-moments"><h3>Opgeslagen momenten</h3>{selectedTrip.moments.slice().reverse().map((moment) => <button className="moment-row" type="button" key={moment.id} onClick={() => editMoment(moment)}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name}` : " · zonder locatie"}</span></button>)}</section>}
    </section>
  );
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
        <Route path="/capture" element={<Capture />} />
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
