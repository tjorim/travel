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
  summary: string | null;
  visibility: "private" | "unlisted" | "public";
  publication_state: "draft" | "published";
  route_stages: RouteStage[];
  moments: Moment[];
  moment_excerpts: MomentExcerpt[];
};

type BroadPlace = {
  id: string;
  label: string;
  country_code: string | null;
  region: string | null;
};

type RouteStage = {
  id: string;
  position: number;
  label: string | null;
  place: BroadPlace;
};

type MomentExcerpt = {
  id: string;
  source_moment_id: string | null;
  broad_place_id: string | null;
  date_precision: "day" | "month" | "year";
  title: string;
  body: string;
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

function apiHeaders(session: TrackerSession): HeadersInit {
  return { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
}

async function apiError(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  throw new Error(body?.detail || fallback);
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
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tripDraft, setTripDraft] = useState({ title: "", summary: "", visibility: "private" as Trip["visibility"], publicationState: "draft" as Trip["publication_state"] });
  const [excerptDraft, setExcerptDraft] = useState({ id: null as string | null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day" as MomentExcerpt["date_precision"], title: "", body: "" });
  const [broadPlaceDraft, setBroadPlaceDraft] = useState({ label: "", countryCode: "", region: "" });
  const [broadPlaces, setBroadPlaces] = useState<BroadPlace[]>([]);
  const [message, setMessage] = useState("Meld aan om je private reizen te laden.");

  async function loadTrips(selectId?: string | null) {
    if (!session) return;
    const response = await fetch("/api/v1/trips", { headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Je reizen konden niet worden geladen.");
    const loaded = await response.json() as Trip[];
    setTrips(loaded);
    setSelectedId((current) => selectId === null ? null : loaded.some((trip) => trip.id === (selectId ?? current)) ? (selectId ?? current) : loaded[0]?.id ?? null);
    setMessage(loaded.length ? "Kies een reis om de private details te beheren." : "Nog geen reizen. Maak je eerste private reis aan.");
  }

  useEffect(() => {
    if (!session) return;
    void loadTrips()
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Je reizen konden niet worden geladen."));
  }, [session]);

  const selectedTrip = trips.find((trip) => trip.id === selectedId) ?? null;

  useEffect(() => {
    if (!session || !selectedId) {
      setBroadPlaces([]);
      return;
    }
    void fetch(`/api/v1/trips/${selectedId}/places/broad`, { headers: apiHeaders(session) })
      .then((response) => response.ok ? response.json() as Promise<BroadPlace[]> : apiError(response, "De brede plaatsen konden niet worden geladen."))
      .then(setBroadPlaces)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede plaatsen konden niet worden geladen."));
  }, [selectedId, session]);

  function newTrip() {
    setSelectedId(null);
    setTripDraft({ title: "", summary: "", visibility: "private", publicationState: "draft" });
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", title: "", body: "" });
    setBroadPlaceDraft({ label: "", countryCode: "", region: "" });
  }

  function selectTrip(trip: Trip) {
    setSelectedId(trip.id);
    setTripDraft({ title: trip.title, summary: trip.summary ?? "", visibility: trip.visibility, publicationState: trip.publication_state });
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", title: "", body: "" });
    setBroadPlaceDraft({ label: "", countryCode: "", region: "" });
  }

  async function saveTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const isNew = !selectedTrip;
    const payload = isNew
      ? { title: tripDraft.title.trim(), summary: tripDraft.summary.trim() || null }
      : { title: tripDraft.title.trim(), summary: tripDraft.summary.trim() || null, visibility: tripDraft.visibility, publication_state: tripDraft.publicationState };
    setMessage(isNew ? "Reis maken…" : "Reis opslaan…");
    const response = await fetch(isNew ? "/api/v1/trips" : `/api/v1/trips/${selectedTrip.id}`, {
      method: isNew ? "POST" : "PATCH", headers: apiHeaders(session), body: JSON.stringify(payload),
    });
    if (!response.ok) return apiError(response, "De reis kon niet worden opgeslagen.");
    const saved = await response.json() as Trip;
    await loadTrips(saved.id);
    setTripDraft({ title: saved.title, summary: saved.summary ?? "", visibility: saved.visibility, publicationState: saved.publication_state });
    setMessage(isNew ? "Private reis gemaakt." : "Reis opgeslagen.");
  }

  async function deleteTrip() {
    if (!session || !selectedTrip || !window.confirm(`Verwijder ${selectedTrip.title} met alle private inhoud?`)) return;
    const response = await fetch(`/api/v1/trips/${selectedTrip.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "De reis kon niet worden verwijderd.");
    await loadTrips(null);
    newTrip();
    setMessage("Reis verwijderd.");
  }

  function editExcerpt(excerpt: MomentExcerpt) {
    setExcerptDraft({ id: excerpt.id, sourceMomentId: excerpt.source_moment_id ?? "", broadPlaceId: excerpt.broad_place_id ?? "", datePrecision: excerpt.date_precision, title: excerpt.title, body: excerpt.body });
  }

  function newExcerpt() {
    setExcerptDraft({ id: null, sourceMomentId: "", broadPlaceId: "", datePrecision: "day", title: "", body: "" });
  }

  async function saveExcerpt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    const payload = {
      source_moment_id: excerptDraft.sourceMomentId || null,
      broad_place_id: excerptDraft.broadPlaceId || null,
      date_precision: excerptDraft.datePrecision,
      title: excerptDraft.title.trim(),
      body: excerptDraft.body.trim(),
    };
    setMessage(excerptDraft.id ? "Uittreksel opslaan…" : "Uittreksel maken…");
    const response = await fetch(excerptDraft.id ? `/api/v1/trips/${selectedTrip.id}/moment-excerpts/${excerptDraft.id}` : `/api/v1/trips/${selectedTrip.id}/moment-excerpts`, {
      method: excerptDraft.id ? "PATCH" : "POST", headers: apiHeaders(session), body: JSON.stringify(payload),
    });
    if (!response.ok) return apiError(response, "Het uittreksel kon niet worden opgeslagen.");
    await loadTrips(selectedTrip.id);
    newExcerpt();
    setMessage("Uittreksel opgeslagen. Het is nog niet gedeeld.");
  }

  async function deleteExcerpt(excerpt: MomentExcerpt) {
    if (!session || !selectedTrip || !window.confirm(`Verwijder uittreksel “${excerpt.title}”?`)) return;
    const response = await fetch(`/api/v1/trips/${selectedTrip.id}/moment-excerpts/${excerpt.id}`, { method: "DELETE", headers: apiHeaders(session) });
    if (!response.ok) return apiError(response, "Het uittreksel kon niet worden verwijderd.");
    await loadTrips(selectedTrip.id);
    newExcerpt();
    setMessage("Uittreksel verwijderd.");
  }

  async function saveBroadPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session || !selectedTrip) return;
    const countryCode = broadPlaceDraft.countryCode.trim().toUpperCase();
    const response = await fetch(`/api/v1/trips/${selectedTrip.id}/places/broad`, {
      method: "POST",
      headers: apiHeaders(session),
      body: JSON.stringify({
        label: broadPlaceDraft.label.trim(),
        country_code: countryCode || null,
        region: broadPlaceDraft.region.trim() || null,
      }),
    });
    if (!response.ok) return apiError(response, "De brede plaats kon niet worden opgeslagen.");
    const saved = await response.json() as BroadPlace;
    setBroadPlaces((current) => [...current, saved]);
    setBroadPlaceDraft({ label: "", countryCode: "", region: "" });
    setMessage("Brede plaats opgeslagen. Je kunt hem nu bewust aan een uittreksel koppelen.");
  }

  if (!session) return <EmptyState title="Reizen">{message}</EmptyState>;

  return <section className="trips" aria-labelledby="trips-title">
    <div className="capture-heading"><div><p className="eyebrow">Private reisbeheer</p><h2 id="trips-title">Reizen</h2></div><button className="secondary compact" type="button" onClick={newTrip}>Nieuwe reis</button></div>
    <p className="help" role="status">{message}</p>
    <div className="trip-layout">
      <section className="trip-list" aria-label="Jouw reizen">
        {trips.map((trip) => <button className={`trip-row ${trip.id === selectedId ? "selected" : ""}`} type="button" key={trip.id} onClick={() => selectTrip(trip)}><strong>{trip.title}</strong><span>{trip.visibility === "private" ? "Privé" : trip.visibility === "public" ? "Publiek" : "Verborgen link"} · {trip.moments.length} momenten</span></button>)}
        {!trips.length && <p>Je eerste reis begint privé en als concept.</p>}
      </section>
      <section className="card">
        <h3>{selectedTrip ? "Reis bewerken" : "Nieuwe reis"}</h3>
        <form className="stack-form" onSubmit={(event) => void saveTrip(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De reis kon niet worden opgeslagen."))}>
          <label>Titel<input required maxLength={160} value={tripDraft.title} onChange={(event) => setTripDraft((draft) => ({ ...draft, title: event.target.value }))} /></label>
          <label>Samenvatting <span className="optional">(optioneel)</span><textarea maxLength={4000} rows={4} value={tripDraft.summary} onChange={(event) => setTripDraft((draft) => ({ ...draft, summary: event.target.value }))} /></label>
          {selectedTrip && <><label>Zichtbaarheid<select value={tripDraft.visibility} onChange={(event) => setTripDraft((draft) => ({ ...draft, visibility: event.target.value as Trip["visibility"], publicationState: event.target.value === "private" ? "draft" : draft.publicationState }))}><option value="private">Privé</option><option value="unlisted">Verborgen link</option><option value="public">Publiek</option></select></label><label>Publicatie<select value={tripDraft.publicationState} onChange={(event) => setTripDraft((draft) => ({ ...draft, publicationState: event.target.value as Trip["publication_state"] }))}><option value="draft">Concept</option><option value="published" disabled={tripDraft.visibility === "private"}>Gepubliceerd</option></select></label><p className="help">Zichtbaarheid maakt niets automatisch deelbaar: kies aparte publicaties wanneer je klaar bent.</p></>}
          <div className="button-row"><button type="submit">{selectedTrip ? "Reis opslaan" : "Reis maken"}</button>{selectedTrip && <button className="danger compact" type="button" onClick={() => void deleteTrip().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De reis kon niet worden verwijderd."))}>Reis verwijderen</button>}</div>
        </form>
      </section>
    </div>
    {selectedTrip && <section className="trip-detail" aria-labelledby="trip-detail-title">
      <div className="capture-heading"><div><p className="eyebrow">{selectedTrip.title}</p><h3 id="trip-detail-title">Private inhoud</h3></div><NavLink className="action-link" to="/capture">Moment vastleggen</NavLink></div>
      <div className="detail-grid">
        <section className="card"><h3>Momenten</h3>{selectedTrip.moments.length ? <div className="saved-moments">{selectedTrip.moments.slice().reverse().map((moment) => <div className="moment-summary" key={moment.id}><strong>{moment.title}</strong><span>{new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(moment.occurred_at))}{moment.place ? ` · ${moment.place.display_name ?? moment.place.locality ?? "exacte plaats"}` : ""}</span></div>)}</div> : <p>Nog geen momenten. Leg er één vast wanneer je wilt.</p>}</section>
        <section className="card"><h3>Brede plaatsen</h3>{broadPlaces.length ? <div className="saved-moments">{broadPlaces.map((place) => <div className="moment-summary" key={place.id}><strong>{place.label}</strong><span>{[place.region, place.country_code].filter(Boolean).join(" · ") || "Alleen voor deze reis"}</span></div>)}</div> : <p>Voeg hieronder een bewust algemene plaats toe om die eventueel aan een uittreksel te koppelen.</p>}</section>
      </div>
      <section className="card"><h3>Brede plaats toevoegen</h3><p>Gebruik alleen een bewust algemene aanduiding, zoals een stad of regio. Er zijn geen exacte coördinaten in dit formulier.</p><form className="stack-form" onSubmit={(event) => void saveBroadPlace(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "De brede plaats kon niet worden opgeslagen."))}><div className="field-row"><label>Naam<input required maxLength={120} value={broadPlaceDraft.label} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, label: event.target.value }))} placeholder="Bijvoorbeeld: Taipei" /></label><label>Landcode <span className="optional">(optioneel)</span><input maxLength={2} value={broadPlaceDraft.countryCode} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, countryCode: event.target.value }))} placeholder="TW" /></label></div><label>Regio <span className="optional">(optioneel)</span><input maxLength={120} value={broadPlaceDraft.region} onChange={(event) => setBroadPlaceDraft((draft) => ({ ...draft, region: event.target.value }))} placeholder="Taipei City" /></label><button type="submit">Brede plaats opslaan</button></form></section>
      <section className="card excerpt-editor"><div className="capture-heading"><div><h3>Moment-uittreksels</h3><p>Een uittreksel is afzonderlijk geschreven en blijft privé totdat je het expliciet publiceert.</p></div>{excerptDraft.id && <button className="secondary compact" type="button" onClick={newExcerpt}>Nieuw uittreksel</button>}</div>
        <form className="stack-form" onSubmit={(event) => void saveExcerpt(event).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het uittreksel kon niet worden opgeslagen."))}>
          <div className="field-row"><label>Bronmoment <span className="optional">(optioneel)</span><select value={excerptDraft.sourceMomentId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, sourceMomentId: event.target.value }))}><option value="">Geen bronmoment</option>{selectedTrip.moments.map((moment) => <option key={moment.id} value={moment.id}>{moment.title}</option>)}</select></label><label>Datumprecisie<select value={excerptDraft.datePrecision} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, datePrecision: event.target.value as MomentExcerpt["date_precision"] }))}><option value="day">Dag</option><option value="month">Maand</option><option value="year">Jaar</option></select></label></div>
          <label>Brede plaats <span className="optional">(optioneel)</span><select value={excerptDraft.broadPlaceId} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, broadPlaceId: event.target.value }))}><option value="">Geen plaats</option>{broadPlaces.map((place) => <option key={place.id} value={place.id}>{place.label}</option>)}</select></label>
          <label>Titel<input required maxLength={160} value={excerptDraft.title} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, title: event.target.value }))} /></label><label>Uittreksel<textarea required maxLength={10000} rows={5} value={excerptDraft.body} onChange={(event) => setExcerptDraft((draft) => ({ ...draft, body: event.target.value }))} /></label>
          <button type="submit">{excerptDraft.id ? "Uittreksel opslaan" : "Uittreksel maken"}</button>
        </form>
        {selectedTrip.moment_excerpts.length > 0 && <div className="saved-moments">{selectedTrip.moment_excerpts.map((excerpt) => <article className="excerpt-row" key={excerpt.id}><div><strong>{excerpt.title}</strong><span>{excerpt.date_precision} · {excerpt.broad_place_id ? broadPlaces.find((place) => place.id === excerpt.broad_place_id)?.label ?? "brede plaats" : "geen plaats"}</span></div><div className="button-row"><button className="secondary compact" type="button" onClick={() => editExcerpt(excerpt)}>Bewerken</button><button className="danger compact" type="button" onClick={() => void deleteExcerpt(excerpt).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Het uittreksel kon niet worden verwijderd."))}>Verwijderen</button></div></article>)}</div>}
      </section>
    </section>}
  </section>;
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

  async function deleteMoment() {
    if (!session || !selectedTrip || !draft.momentId || !window.confirm(`Verwijder moment “${draft.title}”?`)) return;
    setSaveState("Moment verwijderen…");
    try {
      const response = await fetch(`/api/v1/trips/${selectedTrip.id}/moments/${draft.momentId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!response.ok) await apiError(response, "Het moment kon niet worden verwijderd.");
      setTrips((current) => current.map((trip) => trip.id === selectedTrip.id ? { ...trip, moments: trip.moments.filter((moment) => moment.id !== draft.momentId) } : trip));
      localStorage.removeItem(draftKey);
      startNew();
      setDraftState("Moment verwijderd.");
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : "Het moment kon niet worden verwijderd.");
    }
  }

  if (!session) return <EmptyState title="Moment vastleggen">Meld aan om een concept lokaal te bewaren of een moment aan een private reis toe te voegen.</EmptyState>;
  if (loading) return <EmptyState title="Moment vastleggen">Je reizen laden…</EmptyState>;
  if (trips.length === 0) return <EmptyState title="Moment vastleggen">Maak eerst een private reis aan; daarna kun je hier een moment aan toevoegen.</EmptyState>;

  return (
    <section className="capture" aria-labelledby="capture-title">
      <div className="capture-heading">
        <div><p className="eyebrow">Mobiel vastleggen</p><h2 id="capture-title">{draft.momentId ? "Moment bewerken" : "Nieuw moment"}</h2></div>
        {draft.momentId && <div className="button-row"><button className="secondary compact" type="button" onClick={startNew}>Nieuw moment</button><button className="danger compact" type="button" onClick={() => void deleteMoment()}>Verwijderen</button></div>}
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
