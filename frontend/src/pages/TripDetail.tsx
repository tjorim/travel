import { useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";

import { useAuth } from "../auth-context";
import { errorMessage, openOwnerFile } from "../query/api";
import { useOwner, useTripResource, useTripsQuery } from "../query/owner-queries";
import { EmptyState } from "../tracker-routes";
import { bytesLabel, formatDay, formatDayRange, stayLabel, type Place } from "../tracker-model";

function placeLabel(place: Place | null): string {
  if (!place) return "Geen plaats vastgelegd";
  return [place.display_name, place.address_line1, place.address_line2, place.locality, place.admin_area, place.postal_code, place.country_code]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(" · ") || "Exacte plaats";
}

function timestamp(value: string | null): string {
  return value ? new Intl.DateTimeFormat("nl-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="card admin-detail-section"><h2>{title}</h2>{children}</section>;
}

export function TripDetail() {
  const { tripId } = useParams();
  const { session } = useAuth();
  const owner = useOwner();
  const tripsQuery = useTripsQuery();
  const trip = tripId ? tripsQuery.data?.find((candidate) => candidate.id === tripId) ?? null : null;
  // Nothing is read for a trip that does not exist.
  const id = trip ? trip.id : null;
  const placesQuery = useTripResource(id, "places");
  const broadPlacesQuery = useTripResource(id, "places/broad");
  const broadRoutesQuery = useTripResource(id, "broad-routes");
  const staysQuery = useTripResource(id, "stays");
  const legsQuery = useTripResource(id, "transport-legs");
  const itineraryQuery = useTripResource(id, "itinerary-entries");
  const tasksQuery = useTripResource(id, "trip-tasks");
  const documentsQuery = useTripResource(id, "documents");
  const mediaQuery = useTripResource(id, "media");
  const tracksQuery = useTripResource(id, "recorded-tracks");
  const [notice, setNotice] = useState("");

  const places = placesQuery.data;
  const broadPlaces = broadPlacesQuery.data;
  const broadRoutes = broadRoutesQuery.data;
  const stays = staysQuery.data;
  const legs = legsQuery.data;
  const itinerary = itineraryQuery.data;
  const tasks = tasksQuery.data;
  const documents = documentsQuery.data;
  const media = mediaQuery.data;
  const tracks = tracksQuery.data;

  const linkedLabels = useMemo(() => {
    if (!trip || !stays || !legs || !places || !documents) return new Map<string, string>();
    return new Map<string, string>([
      ...stays.map((item): [string, string] => [item.id, `Verblijf: ${stayLabel(item)}`]),
      ...legs.map((item): [string, string] => [item.id, `Vervoer: ${placeLabel(item.departure_place)} → ${placeLabel(item.arrival_place)}`]),
      ...trip.route_stages.map((item): [string, string] => [item.id, `Route-etappe: ${item.label ?? item.place.label}`]),
      ...places.map((item): [string, string] => [item.id, `Exacte plaats: ${placeLabel(item)}`]),
      ...documents.map((item): [string, string] => [item.id, `Document: ${item.title}`]),
      ...trip.moments.map((item): [string, string] => [item.id, `Moment: ${item.title}`]),
    ]);
  }, [trip, stays, legs, places, documents]);

  const readError = [tripsQuery, placesQuery, broadPlacesQuery, broadRoutesQuery, staysQuery, legsQuery, itineraryQuery, tasksQuery, documentsQuery, mediaQuery, tracksQuery].find((query) => query.isError)?.error;

  if (!session) return <EmptyState title="Private reis">Meld aan om private reisdetails te bekijken.</EmptyState>;
  if (!tripId) return <EmptyState title="Reis niet gevonden">Deze reis heeft geen geldige identificatie.</EmptyState>;
  if (tripsQuery.isSuccess && !trip) return <EmptyState title="Reis niet gevonden">Deze private reis bestaat niet of is niet beschikbaar voor jouw account.</EmptyState>;
  // The page shows a whole trip or nothing: a partial page would read as if records were missing.
  if (!trip || !places || !broadPlaces || !broadRoutes || !stays || !legs || !itinerary || !tasks || !documents || !media || !tracks) {
    return <section className="card" role={readError ? "alert" : "status"}><h2>Private reis</h2><p>{readError ? "De private reis kon niet volledig worden geladen." : "Private reis laden…"}</p></section>;
  }

  const openFile = (url: string, fallback: string) => { if (owner) openOwnerFile(owner.session, url, fallback).catch((error: unknown) => setNotice(errorMessage(error, fallback))); };
  return <main className="admin-trip-detail" aria-labelledby="admin-trip-title">
    <header className="capture-heading"><div><p className="eyebrow">Alleen voor jou · private reis</p><h1 id="admin-trip-title">{trip.title}</h1>{trip.summary && <p className="lede">{trip.summary}</p>}{trip.starts_on && <p>{formatDayRange(trip.starts_on, trip.ends_on ?? trip.starts_on)}</p>}</div><NavLink className="action-link" to="/trips">Naar beheren</NavLink></header>
    <p className="help">Deze pagina gebruikt uitsluitend owner-endpoints. Hij maakt geen deellink en levert geen gegevens aan bezoekers.</p>

    <Section title="Momenten">
      {trip.moments.length ? <div className="admin-detail-list">{trip.moments.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((moment) => <article key={moment.id}><h3>{moment.title}</h3><p>{timestamp(moment.occurred_at)} · {placeLabel(moment.place)}</p>{moment.story && <p>{moment.story}</p>}<small>{moment.media_asset_ids.length} gekoppelde {moment.media_asset_ids.length === 1 ? "media-item" : "media-items"}</small></article>)}</div> : <p>Geen momenten vastgelegd.</p>}
    </Section>
    <Section title="Dagplanning">
      {itinerary.length ? <ol className="admin-detail-list">{itinerary.slice().sort((a, b) => a.position - b.position).map((entry) => <li key={entry.id}><strong>{entry.title}</strong><span>{entry.day_date ? formatDayRange(entry.day_date, entry.end_date ?? entry.day_date) : "Zonder datum"}{entry.kind ? ` · ${entry.kind}` : ""}{entry.tentative ? " · voorlopig" : ""}</span>{entry.notes && <p>{entry.notes}</p>}{entry.linked_id && <small>{linkedLabels.get(entry.linked_id) ?? "Gekoppeld onderdeel is verwijderd"}</small>}</li>)}</ol> : <p>Geen dagplanning vastgelegd.</p>}
    </Section>
    <Section title="Verblijven">
      {stays.length ? <div className="admin-detail-list">{stays.slice().sort((a, b) => a.check_in_date.localeCompare(b.check_in_date)).map((stay) => <article key={stay.id}><h3>{stayLabel(stay)}</h3><p>{formatDayRange(stay.check_in_date, stay.check_out_date)} · {stay.status}</p><p>{placeLabel(stay.place)}{stay.broad_place ? ` · ${stay.broad_place.label}` : ""}</p>{stay.website_url && <a href={stay.website_url} target="_blank" rel="noreferrer">Website accommodatie</a>}{stay.booking_reference && <p>Boekingsreferentie: {stay.booking_reference}</p>}{stay.contact_details && <p>Contact: {stay.contact_details}</p>}{stay.notes && <p>{stay.notes}</p>}</article>)}</div> : <p>Geen verblijven vastgelegd.</p>}
    </Section>
    <Section title="Vervoer">
      {legs.length ? <div className="admin-detail-list">{legs.slice().sort((a, b) => a.departs_at.localeCompare(b.departs_at)).map((leg) => <article key={leg.id}><h3>{placeLabel(leg.departure_place)} → {placeLabel(leg.arrival_place)}</h3><p>{timestamp(leg.departs_at)} → {timestamp(leg.arrives_at)} · {leg.kind} · {leg.status}</p><p>{[leg.carrier, leg.service_reference, leg.travel_class].filter(Boolean).join(" · ")}</p>{leg.booking_reference && <p>Boekingsreferentie: {leg.booking_reference}</p>}{leg.notes && <p>{leg.notes}</p>}</article>)}</div> : <p>Geen vervoer vastgelegd.</p>}
    </Section>
    <Section title="Taken">
      {tasks.length ? <div className="admin-detail-list">{tasks.slice().sort((a, b) => (a.completed_at ? 1 : 0) - (b.completed_at ? 1 : 0) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).map((task) => <article key={task.id}><h3>{task.title}</h3><p>{task.completed_at ? `Afgerond op ${timestamp(task.completed_at)}` : task.due_date ? `Voor ${formatDay(task.due_date)}` : "Geen deadline"}</p>{task.notes && <p>{task.notes}</p>}{task.links.map((link) => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></p>)}</article>)}</div> : <p>Geen taken vastgelegd.</p>}
    </Section>
    <Section title="Exacte plaatsen">
      {places.length ? <div className="admin-detail-list">{places.map((place) => <article key={place.id}><h3>{placeLabel(place)}</h3>{place.notes && <p>{place.notes}</p>}{place.latitude != null && place.longitude != null && <p>Coördinaten: {place.latitude}, {place.longitude}</p>}</article>)}</div> : <p>Geen exacte plaatsen vastgelegd.</p>}
    </Section>
    <Section title="Brede route en plaatsen">
      {trip.route_stages.length > 0 && <div className="admin-detail-list">{trip.route_stages.slice().sort((a, b) => a.position - b.position).map((stage) => <article key={stage.id}><h3>{stage.label ?? stage.place.label}</h3><p>{stage.place.label}{stage.summary ? ` · ${stage.summary}` : ""}</p></article>)}</div>}
      {broadPlaces.length > 0 && <p>{broadPlaces.map((place) => [place.label, place.region, place.country_code].filter(Boolean).join(" · ")).join("; ")}</p>}
      {broadRoutes.length > 0 && <p>{broadRoutes.map((route) => `${route.label} (${route.geometry.coordinates.length} punten)`).join("; ")}</p>}
      {!trip.route_stages.length && !broadPlaces.length && !broadRoutes.length && <p>Geen brede route of plaatsen vastgelegd.</p>}
    </Section>
    <Section title="Privédocumenten">
      {documents.length ? <div className="admin-detail-list">{documents.map((document) => <article key={document.id}><h3>{document.title}</h3><p>{document.document_kind} · {document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</p><button className="secondary compact" type="button" onClick={() => openFile(document.file_url, "Het private document kon niet worden geopend.")}>Document openen</button></article>)}</div> : <p>Geen privédocumenten vastgelegd.</p>}
    </Section>
    <Section title="Privémedia en opgenomen routes">
      {media.length ? <div className="admin-detail-list">{media.map((asset) => <article key={asset.id}><h3>{asset.original_filename ?? "Naamloos medium"}</h3><p>{asset.media_kind} · {bytesLabel(asset.byte_size)} · vastgelegd {timestamp(asset.captured_at)}</p>{asset.gps && <p>GPS: {asset.gps.latitude}, {asset.gps.longitude}</p>}<button className="secondary compact" type="button" onClick={() => openFile(asset.file_url, "De privemedia konden niet worden geopend.")}>Media openen</button></article>)}</div> : <p>Geen privémedia vastgelegd.</p>}
      {tracks.length > 0 && <div className="admin-detail-list">{tracks.map((track) => <article key={track.id}><h3>Opgenomen route</h3><p>{timestamp(track.started_at)} — {timestamp(track.ended_at)} · {track.kind} · {bytesLabel(track.byte_size)}</p></article>)}</div>}
    </Section>
    {notice && <p className="help" role="status">{notice}</p>}
  </main>;
}
