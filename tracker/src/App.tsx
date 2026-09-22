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
  display_name: string | null;
  osm_element_type: "node" | "way" | "relation" | null;
  osm_element_id: string | null;
  address_line1: string | null;
  address_line2: string | null;
  locality: string | null;
  admin_area: string | null;
  postal_code: string | null;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  viewport_north: number | null;
  viewport_south: number | null;
  viewport_east: number | null;
  viewport_west: number | null;
  navigation_provider: string | null;
  navigation_provider_place_id: string | null;
  notes: string | null;
};

type ExactPlaceInput = Partial<Omit<Place, "id">>;

type PlaceSearchResult = ExactPlaceInput;

type MediaAsset = {
  id: string;
  media_kind: "photo" | "video";
  captured_at: string | null;
  original_filename: string | null;
  gps: { latitude: number; longitude: number } | null;
};

type PlaceSearchResponse = {
  attribution: string;
  attribution_url: string;
  results: PlaceSearchResult[];
};

type Moment = {
  id: string;
  occurred_at: string;
  title: string;
  story: string;
  place: Place | null;
  media_asset_ids: string[];
};

type Trip = {
  id: string;
  title: string;
  visibility: "private" | "unlisted" | "public";
  publication_state: "draft" | "published";
  moments: Moment[];
};

type MomentDraft = {
  tripId: string;
  momentId: string | null;
  occurredAt: string;
  title: string;
  story: string;
  place: ExactPlaceInput | null;
  mediaAssetIds: string[];
};

const draftKey = "travel-tracker-moment-draft-v1";

function localDateTime(value = new Date()): string {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function emptyDraft(tripId = ""): MomentDraft {
  return { tripId, momentId: null, occurredAt: localDateTime(), title: "", story: "", place: null, mediaAssetIds: [] };
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
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [mediaState, setMediaState] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceSearchResponse | null>(null);
  const [placeState, setPlaceState] = useState("");
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);

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
  const attachedMedia = useMemo(
    () => draft.mediaAssetIds.map((id) => media.find((asset) => asset.id === id)).filter((asset): asset is MediaAsset => Boolean(asset)),
    [draft.mediaAssetIds, media],
  );

  useEffect(() => {
    if (!session || !selectedTrip) {
      setMedia([]);
      return;
    }
    setMediaState("Media laden…");
    void fetch(`/api/v1/trips/${selectedTrip.id}/media`, { headers: { Authorization: `Bearer ${session.accessToken}` } })
      .then((response) => response.ok ? response.json() as Promise<MediaAsset[]> : Promise.reject(new Error("Je media konden niet worden geladen.")))
      .then((assets) => {
        setMedia(assets.filter((asset) => asset.media_kind === "photo"));
        setMediaState(assets.length ? "Kies privéfoto’s om aan dit moment te koppelen." : "Nog geen foto’s in deze reis.");
      })
      .catch((error: unknown) => setMediaState(error instanceof Error ? error.message : "Je media konden niet worden geladen."));
  }, [selectedTrip, session]);

  function updateDraft(values: Partial<MomentDraft>) {
    setDraft((current) => ({ ...current, ...values }));
    setSaveState("");
  }

  function startNew() {
    const next = emptyDraft(selectedTrip?.id ?? trips[0]?.id ?? "");
    setDraft(next);
    setPlaceQuery("");
    setPlaceResults(null);
    setPlaceState("");
    setDismissedSuggestions([]);
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
      place: moment.place,
      mediaAssetIds: moment.media_asset_ids,
    });
    setPlaceQuery("");
    setPlaceResults(null);
    setPlaceState("");
    setDismissedSuggestions([]);
    setSaveState("Je bewerkt een opgeslagen moment.");
  }

  function toggleMedia(assetId: string) {
    updateDraft({ mediaAssetIds: draft.mediaAssetIds.includes(assetId) ? draft.mediaAssetIds.filter((id) => id !== assetId) : [...draft.mediaAssetIds, assetId] });
    setDismissedSuggestions((current) => current.filter((id) => id !== assetId));
  }

  function selectPlace(result: PlaceSearchResult) {
    updateDraft({ place: result });
    setPlaceState("Plaats geselecteerd. Hij wordt pas gemaakt wanneer je het moment opslaat.");
    setPlaceResults(null);
  }

  async function searchPlace() {
    if (!session || !selectedTrip || placeQuery.trim().length < 2) {
      setPlaceState("Vul minstens twee tekens in om een plaats te zoeken.");
      return;
    }
    setPlaceState("Plaatsen zoeken…");
    try {
      const response = await fetch(`/api/v1/trips/${selectedTrip.id}/places/search`, {
        method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: placeQuery.trim() }),
      });
      if (!response.ok) throw new Error("Plaatsen zoeken is nu niet beschikbaar.");
      const result = await response.json() as PlaceSearchResponse;
      setPlaceResults(result);
      setPlaceState(result.results.length ? "Kies een resultaat. Er wordt nog niets opgeslagen." : "Geen plaatsen gevonden.");
    } catch (error) {
      setPlaceState(error instanceof Error ? error.message : "Plaatsen zoeken is mislukt.");
    }
  }

  async function reverseGeocode(asset: MediaAsset) {
    if (!session || !selectedTrip || !asset.gps) return;
    setPlaceState("De fotolocatie wordt alleen voor jou opgezocht…");
    try {
      const response = await fetch(`/api/v1/trips/${selectedTrip.id}/places/reverse`, {
        method: "POST", headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(asset.gps),
      });
      if (!response.ok) throw new Error("Deze fotolocatie kon niet worden opgezocht.");
      const result = await response.json() as PlaceSearchResponse;
      setPlaceResults(result);
      setPlaceState(result.results.length ? "Kies de voorgestelde plaats. Er wordt nog niets opgeslagen." : "Voor deze fotolocatie is geen plaats gevonden.");
    } catch (error) {
      setPlaceState(error instanceof Error ? error.message : "Deze fotolocatie kon niet worden opgezocht.");
    }
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
    const payload = {
      occurred_at: new Date(draft.occurredAt).toISOString(),
      title: draft.title.trim(),
      story: draft.story.trim(),
      place: draft.place,
      media_asset_ids: draft.mediaAssetIds,
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
      setPlaceQuery("");
      setPlaceResults(null);
      setPlaceState("");
      setDismissedSuggestions([]);
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
        <label>Reis<select value={draft.tripId} onChange={(event) => updateDraft({ tripId: event.target.value, momentId: null, place: null, mediaAssetIds: [] })}>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}</select></label>
        {selectedTrip && <aside className="publication" aria-label="Zichtbaarheid van dit moment"><strong>Voor je opslaat</strong><span>{publicationDescription(selectedTrip)}</span></aside>}
        <div className="field-row"><label>Datum en tijd<input required type="datetime-local" value={draft.occurredAt} onChange={(event) => updateDraft({ occurredAt: event.target.value })} /></label><label>Titel<input required maxLength={160} value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Bijvoorbeeld: eerste avond" /></label></div>
        <label>Je moment<textarea required maxLength={10000} rows={6} value={draft.story} onChange={(event) => updateDraft({ story: event.target.value })} placeholder="Wat wil je onthouden?" /></label>
        <fieldset className="location"><legend>Privéfoto’s koppelen</legend><p>Een koppeling is privé. EXIF wordt alleen hieronder als voorstel gebruikt; geen datum of plaats verandert zonder jouw keuze.</p>
          <p className="help" role="status">{mediaState}</p>
          {media.map((asset) => <label className="media-choice" key={asset.id}><input type="checkbox" checked={draft.mediaAssetIds.includes(asset.id)} onChange={() => toggleMedia(asset.id)} />{asset.original_filename ?? "Naamloze foto"}{asset.captured_at ? ` · ${new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.captured_at))}` : ""}</label>)}
          {attachedMedia.map((asset) => !dismissedSuggestions.includes(asset.id) && (asset.captured_at || asset.gps) && <aside className="exif-suggestion" key={`suggestion-${asset.id}`}><strong>Voorstel uit {asset.original_filename ?? "deze foto"}</strong>
            {asset.captured_at && <span>Opname: {new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(asset.captured_at))}.</span>}
            <div className="button-row">{asset.captured_at && <button className="secondary compact" type="button" onClick={() => { updateDraft({ occurredAt: localDateTime(new Date(asset.captured_at!)) }); setSaveState("Opnamedatum als voorstel overgenomen — pas hem gerust aan."); }}>Gebruik opnamedatum</button>}{asset.gps && <button className="secondary compact" type="button" onClick={() => void reverseGeocode(asset)}>Zoek plaats bij foto</button>}<button className="secondary compact" type="button" onClick={() => setDismissedSuggestions((current) => [...current, asset.id])}>Voorstel negeren</button></div>
          </aside>)}
          {attachedMedia.filter((asset) => asset.captured_at || asset.gps).length > 1 && <p className="help">Foto’s kunnen verschillen. Elk voorstel blijft afzonderlijk zichtbaar; jij kiest er hoogstens één en kunt die altijd weer aanpassen.</p>}
        </fieldset>
        <fieldset className="location"><legend>Exacte plaats — volledig optioneel</legend><p>Zoek en kies een plaats. Deze wordt pas samen met jouw opgeslagen moment als private plaats gemaakt.</p>
          <div className="field-row"><label>Zoek plaats<input value={placeQuery} onChange={(event) => setPlaceQuery(event.target.value)} placeholder="Bijvoorbeeld: Taipei Main Station" /></label><div className="button-field"><button className="secondary" type="button" onClick={() => void searchPlace()}>Zoeken</button></div></div>
          {draft.place && <p className="selected-place"><strong>Gekozen plaats:</strong> {draft.place.display_name ?? draft.place.locality ?? "Naamloze plaats"} <button className="secondary compact" type="button" onClick={() => updateDraft({ place: null })}>Verwijderen</button></p>}
          {placeState && <p className="help" role="status">{placeState}</p>}
          {placeResults && <div className="place-results">{placeResults.results.map((result) => <button className="place-result" type="button" key={`${result.osm_element_type}-${result.osm_element_id}`} onClick={() => selectPlace(result)}>{result.display_name}</button>)}<p className="help">Zoekresultaten: <a href={placeResults.attribution_url} target="_blank" rel="noreferrer">{placeResults.attribution}</a></p></div>}
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
