import { useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";

import { useAuth } from "../auth-context";
import { errorMessage, openOwnerFile } from "../query/api";
import { useOwner, useTripResource, useTripsQuery } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { EmptyState } from "../tracker-routes";
import { ROUTE_MODE_LABELS, bytesLabel, formatDay, formatDayRange, routeTitle, stayLabel, visitTitle, type Location } from "../tracker-model";
import { visitWhen } from "../trips/VisitManager";
import { visibilityLabel } from "../trips/visibility";

function placeLabel(place: Location | null): string {
  if (!place) return "Geen locatie vastgelegd";
  return [place.display_name, place.address_line1, place.address_line2, place.locality, place.admin_area, place.postal_code, place.country_code]
    .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
    .join(" · ") || "Locatie";
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
  const placesQuery = useTripResource(id, "locations");
  const areasQuery = useTripResource(id, "areas");
  const routesQuery = useTripResource(id, "routes");
  const staysQuery = useTripResource(id, "stays");
  const visitsQuery = useTripResource(id, "visits");
  const tasksQuery = useTripResource(id, "trip-tasks");
  const documentsQuery = useTripResource(id, "documents");
  const mediaQuery = useTripResource(id, "media");
  const [notice, setNotice] = useState("");

  const places = placesQuery.data;
  const areas = areasQuery.data;
  const routes = routesQuery.data;
  const stays = staysQuery.data;
  const visits = visitsQuery.data;
  const tasks = tasksQuery.data;
  const documents = documentsQuery.data;
  const media = mediaQuery.data;

  const readError = [tripsQuery, placesQuery, areasQuery, routesQuery, staysQuery, visitsQuery, tasksQuery, documentsQuery, mediaQuery].find((query) => query.isError)?.error;

  if (!session) return <EmptyState title="Private reis">Meld aan om private reisdetails te bekijken.</EmptyState>;
  if (!tripId) return <EmptyState title="Reis niet gevonden">Deze reis heeft geen geldige identificatie.</EmptyState>;
  if (tripsQuery.isSuccess && !trip) return <EmptyState title="Reis niet gevonden">Deze private reis bestaat niet of is niet beschikbaar voor jouw account.</EmptyState>;
  // The page shows a whole trip or nothing: a partial page would read as if records were missing.
  if (!trip || !places || !areas || !routes || !stays || !visits || !tasks || !documents || !media) {
    return <section className="card" role={readError ? "alert" : "status"}><h2>Private reis</h2><p>{readError ? "De private reis kon niet volledig worden geladen." : "Private reis laden…"}</p></section>;
  }

  const openFile = (url: string, fallback: string) => { if (owner) openOwnerFile(owner.session, url, fallback).catch((error: unknown) => setNotice(errorMessage(error, fallback))); };
  return <main className="admin-trip-detail" aria-labelledby="admin-trip-title">
    <header className="capture-heading"><div><p className="eyebrow">Alleen voor jou · private reis</p><h1 id="admin-trip-title">{trip.title}</h1><Markdown className="lede" html={trip.summary_html} text={trip.summary} />{trip.starts_on && <p>{formatDayRange(trip.starts_on, trip.ends_on ?? trip.starts_on)}</p>}</div><NavLink className="action-link" to={`/trips/${encodeURIComponent(trip.id)}`}>Naar reisbeheer</NavLink></header>
    <p className="help">Deze pagina gebruikt uitsluitend owner-endpoints. Hij maakt geen deellink en levert geen gegevens aan bezoekers.</p>

    <Section title="Reisupdates">
      {trip.travel_updates.length ? <div className="admin-detail-list">{trip.travel_updates.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((update) => <article key={update.id}><h3>{update.title}</h3><p>{timestamp(update.occurred_at)} · {placeLabel(update.location)}</p><Markdown html={update.private_notes_html} text={update.private_notes} /><small>{update.media_asset_ids.length} gekoppelde {update.media_asset_ids.length === 1 ? "media-item" : "media-items"} · {visibilityLabel(update.visibility)}</small></article>)}</div> : <p>Geen reisupdates vastgelegd.</p>}
    </Section>
    <Section title="Bezoeken">
      {visits.length ? <ol className="admin-detail-list">{visits.map((visit) => <li key={visit.id}><strong>{visitTitle(visit)}</strong><span>{visitWhen(visit)}{visit.kind ? ` · ${visit.kind}` : ""} · {visit.location ? `${placeLabel(visit.location)} · ` : ""}{visit.area.label}</span><Markdown html={visit.notes_html} text={visit.notes} />{visit.summary && <><p className="markdown-label">Voor bezoekers</p><Markdown html={visit.summary_html} text={visit.summary} /></>}</li>)}</ol> : <p>Nog geen bezoeken.</p>}
    </Section>
    <Section title="Verblijven">
      {stays.length ? <div className="admin-detail-list">{stays.slice().sort((a, b) => a.check_in_date.localeCompare(b.check_in_date)).map((stay) => <article key={stay.id}><h3>{stayLabel(stay)}</h3><p>{formatDayRange(stay.check_in_date, stay.check_out_date)} · {stay.status}</p><p>{placeLabel(stay.location)}{` · ${stay.area.label}`}</p>{stay.website_url && <a href={stay.website_url} target="_blank" rel="noreferrer">Website accommodatie</a>}{stay.booking_reference && <p>Boekingsreferentie: {stay.booking_reference}</p>}{stay.contact_details && <><p className="markdown-label">Contact</p><Markdown html={stay.contact_details_html} text={stay.contact_details} /></>}<Markdown html={stay.notes_html} text={stay.notes} /></article>)}</div> : <p>Geen verblijven vastgelegd.</p>}
    </Section>
    <Section title="Routes">
      {routes.length ? <div className="admin-detail-list">{routes.map((route) => <article key={route.id}><h3>{routeTitle(route)}</h3><p>{[ROUTE_MODE_LABELS[route.mode], route.status, route.departs_at && route.arrives_at ? `${timestamp(route.departs_at)} → ${timestamp(route.arrives_at)}` : null, route.geometry ? `lijn van ${route.geometry.coordinates.length} punten` : null].filter(Boolean).join(" · ")}</p><p>{[route.departure_location && placeLabel(route.departure_location), route.arrival_location && placeLabel(route.arrival_location)].filter(Boolean).join(" → ")}</p><p>{[route.carrier, route.service_reference, route.travel_class].filter(Boolean).join(" · ")}</p>{route.booking_reference && <p>Boekingsreferentie: {route.booking_reference}</p>}<Markdown html={route.notes_html} text={route.notes} /></article>)}</div> : <p>Geen routes vastgelegd.</p>}
    </Section>
    <Section title="Taken">
      {tasks.length ? <div className="admin-detail-list">{tasks.slice().sort((a, b) => (a.completed_at ? 1 : 0) - (b.completed_at ? 1 : 0) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).map((task) => <article key={task.id}><h3>{task.title}</h3><p>{task.completed_at ? `Afgerond op ${timestamp(task.completed_at)}` : task.due_date ? `Voor ${formatDay(task.due_date)}` : "Geen deadline"}</p><Markdown html={task.notes_html} text={task.notes} />{task.links.map((link) => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></p>)}</article>)}</div> : <p>Geen taken vastgelegd.</p>}
    </Section>
    <Section title="Locaties">
      {places.length ? <div className="admin-detail-list">{places.map((place) => <article key={place.id}><h3>{placeLabel(place)}</h3><Markdown html={place.notes_html} text={place.notes} />{place.latitude != null && place.longitude != null && <p>Coördinaten: {place.latitude}, {place.longitude}</p>}</article>)}</div> : <p>Geen locaties vastgelegd.</p>}
    </Section>
    <Section title="Gebieden">
      {areas.length > 0 && <p>{areas.map((place) => [place.label, place.region, place.country_code].filter(Boolean).join(" · ")).join("; ")}</p>}
      {!areas.length && <p>Nog geen gebieden vastgelegd.</p>}
    </Section>
    <Section title="Privédocumenten">
      {documents.length ? <div className="admin-detail-list">{documents.map((document) => <article key={document.id}><h3>{document.title}</h3><p>{document.document_kind} · {document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</p><button className="secondary compact" type="button" onClick={() => openFile(document.file_url, "Het private document kon niet worden geopend.")}>Document openen</button></article>)}</div> : <p>Geen privédocumenten vastgelegd.</p>}
    </Section>
    <Section title="Privémedia">
      {media.length ? <div className="admin-detail-list">{media.map((asset) => <article key={asset.id}><h3>{asset.original_filename ?? "Naamloos medium"}</h3><p>{asset.media_kind} · {bytesLabel(asset.byte_size)} · vastgelegd {timestamp(asset.captured_at)}</p>{asset.gps && <p>GPS: {asset.gps.latitude}, {asset.gps.longitude}</p>}<button className="secondary compact" type="button" onClick={() => openFile(asset.file_url, "De privemedia konden niet worden geopend.")}>Media openen</button></article>)}</div> : <p>Geen privémedia vastgelegd.</p>}
    </Section>
    {notice && <p className="help" role="status">{notice}</p>}
  </main>;
}
