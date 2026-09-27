import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";

import { useAuth } from "../auth-context";
import { errorMessage, openOwnerFile } from "../query/api";
import { useOwner, useTripResource, useTripsQuery } from "../query/owner-queries";
import { Markdown } from "../Markdown";
import { EmptyState } from "../tracker-routes";
import { DOCUMENT_KIND_LABELS } from "../trips/DocumentManager";
import { MEDIA_KIND_LABELS } from "../trips/MediaManager";
import { ROUTE_STATUS_LABELS } from "../trips/RouteManager";
import { stayStateLabel } from "../trips/StayManager";
import { OwnerTripMap } from "../trips/OwnerTripMap";
import { TripOverview } from "../trips/TripOverview";
import { visitWhen, VISIT_KIND_LABELS, VISIT_STATUS_LABELS } from "../trips/VisitManager";
import { visibilityLabel } from "../trips/visibility";
import { ROUTE_MODE_LABELS, bytesLabel, formatDay, formatDayRange, formatInstant, locationName, routeTitle, stayLabel, visitTitle, type Location } from "../tracker-model";

type RecordKind = "stay" | "route" | "visit" | "area" | "task" | "update" | "document" | "media";
/** Which workspace tab a record kind's dialog opens in. */
const RECORD_SECTION: Record<RecordKind, "plan" | "story" | "media"> = { stay: "plan", route: "plan", visit: "plan", area: "plan", task: "plan", update: "story", document: "media", media: "media" };

/** A link to the trip workspace that opens the given record's dialog there. */
function RecordLink({ tripId, kind, id, children }: { tripId: string; kind: RecordKind; id: string; children: React.ReactNode }) {
  return <Link className="action-link compact" to={`/trips/${encodeURIComponent(tripId)}/${RECORD_SECTION[kind]}`} state={{ openRecord: { kind, id } }}>{children}</Link>;
}

/** A record's title beside a link to its dialog, kept out of the heading's own accessible name. */
function RecordHeading({ tripId, kind, id, children }: { tripId: string; kind: RecordKind; id: string; children: React.ReactNode }) {
  return <div className="admin-detail-heading"><h3>{children}</h3><RecordLink tripId={tripId} kind={kind} id={id}>Openen</RecordLink></div>;
}

function placeLabel(place: Location | null): string {
  if (!place) return "Geen locatie vastgelegd";
  const name = locationName(place);
  const extra = [place.address_line1, place.locality, place.country_code]
    .filter((value, index, values): value is string => Boolean(value) && value !== name && values.indexOf(value) === index);
  return extra.length ? `${name} · ${extra.join(" · ")}` : name;
}

function timestamp(value: string | null): string {
  return value ? formatInstant(value) : "—";
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="card admin-detail-section"><h2>{title}</h2>{children}</section>;
}

const SECTIONS: { id: string; label: string }[] = [
  { id: "updates", label: "Reisupdates" },
  { id: "visits", label: "Bezoeken" },
  { id: "stays", label: "Verblijven" },
  { id: "routes", label: "Routes" },
  { id: "tasks", label: "Taken" },
  { id: "locations", label: "Locaties" },
  { id: "areas", label: "Gebieden" },
  { id: "documents", label: "Privédocumenten" },
  { id: "media", label: "Privémedia" },
];

export function TripDetail() {
  const { tripId } = useParams({ strict: false });
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
    <header className="trip-workspace-header">
      <div><p className="eyebrow">Alleen voor jou · volledig privéoverzicht</p><h1 id="admin-trip-title">{trip.title}</h1>{trip.starts_on && <p>{formatDayRange(trip.starts_on, trip.ends_on ?? trip.starts_on)}</p>}</div>
      <Link className="action-link" to={`/trips/${encodeURIComponent(trip.id)}`}>Naar reisbeheer</Link>
    </header>
    <TripOverview trip={trip} />
    <OwnerTripMap trip={trip} areas={areas} />
    <nav className="plan-jump-nav" aria-label="Onderdelen van dit overzicht">
      {SECTIONS.map(({ id: sectionId, label }) => <a key={sectionId} href={`#${sectionId}`}>{label}</a>)}
    </nav>
    {notice && <p className="help" role="status">{notice}</p>}

    <Section id="updates" title="Reisupdates">
      {trip.travel_updates.length ? <div className="admin-detail-list">{trip.travel_updates.slice().sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((update) => <article key={update.id}>
        <RecordHeading tripId={trip.id} kind="update" id={update.id}>{update.title}</RecordHeading>
        <p>{timestamp(update.occurred_at)} · {placeLabel(update.location)} · {visibilityLabel(update.visibility)}</p>
        <p className="markdown-label">Voor bezoekers</p>
        {update.body ? <Markdown html={update.body_html} text={update.body} /> : <p className="help">Nog geen tekst voor bezoekers.</p>}
        {update.private_notes && <><p className="markdown-label">Privénotitie</p><Markdown html={update.private_notes_html} text={update.private_notes} /></>}
        <small>{update.media_asset_ids.length} gekoppelde {update.media_asset_ids.length === 1 ? "media-item" : "media-items"}</small>
      </article>)}</div> : <p>Geen reisupdates vastgelegd.</p>}
    </Section>
    <Section id="visits" title="Bezoeken">
      {visits.length ? <ol className="admin-detail-list">{visits.map((visit) => <li key={visit.id}>
        <RecordHeading tripId={trip.id} kind="visit" id={visit.id}><strong>{visitTitle(visit)}</strong></RecordHeading>
        <span>{visitWhen(visit)}{visit.kind ? ` · ${VISIT_KIND_LABELS[visit.kind]}` : ""}{visit.status ? ` · ${VISIT_STATUS_LABELS[visit.status]}` : ""} · {visit.location ? `${placeLabel(visit.location)} · ` : ""}{visit.area.label}</span>
        <Markdown html={visit.notes_html} text={visit.notes} />
        {visit.summary && <><p className="markdown-label">Voor bezoekers</p><Markdown html={visit.summary_html} text={visit.summary} /></>}
      </li>)}</ol> : <p>Nog geen bezoeken.</p>}
    </Section>
    <Section id="stays" title="Verblijven">
      {stays.length ? <div className="admin-detail-list">{stays.slice().sort((a, b) => a.check_in_date.localeCompare(b.check_in_date)).map((stay) => <article key={stay.id}>
        <RecordHeading tripId={trip.id} kind="stay" id={stay.id}>{stayLabel(stay)}</RecordHeading>
        <p>{formatDayRange(stay.check_in_date, stay.check_out_date)} · {stayStateLabel(stay)}</p>
        <p>{placeLabel(stay.location)}{` · ${stay.area.label}`}</p>
        {stay.website_url && <a href={stay.website_url} target="_blank" rel="noreferrer">Website accommodatie</a>}
        {stay.booking_reference && <p>Boekingsreferentie: {stay.booking_reference}</p>}
        {stay.contact_details && <><p className="markdown-label">Contact</p><Markdown html={stay.contact_details_html} text={stay.contact_details} /></>}
        <Markdown html={stay.notes_html} text={stay.notes} />
      </article>)}</div> : <p>Geen verblijven vastgelegd.</p>}
    </Section>
    <Section id="routes" title="Routes">
      {routes.length ? <div className="admin-detail-list">{routes.map((route) => <article key={route.id}>
        <RecordHeading tripId={trip.id} kind="route" id={route.id}>{routeTitle(route)}</RecordHeading>
        <p>{[ROUTE_MODE_LABELS[route.mode], ROUTE_STATUS_LABELS[route.status], route.departs_at && route.arrives_at ? `${timestamp(route.departs_at)} → ${timestamp(route.arrives_at)}` : route.departs_on ? formatDay(route.departs_on) : null, route.geometry ? `lijn van ${route.geometry.coordinates.length} punten` : null].filter(Boolean).join(" · ")}</p>
        <p>{[route.departure_location && placeLabel(route.departure_location), route.arrival_location && placeLabel(route.arrival_location)].filter(Boolean).join(" → ")}</p>
        <p>{[route.carrier, route.service_reference, route.travel_class].filter(Boolean).join(" · ")}</p>
        {route.booking_reference && <p>Boekingsreferentie: {route.booking_reference}</p>}
        <Markdown html={route.notes_html} text={route.notes} />
      </article>)}</div> : <p>Geen routes vastgelegd.</p>}
    </Section>
    <Section id="tasks" title="Taken">
      {tasks.length ? <div className="admin-detail-list">{tasks.slice().sort((a, b) => (a.completed_at ? 1 : 0) - (b.completed_at ? 1 : 0) || (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")).map((task) => <article key={task.id}>
        <RecordHeading tripId={trip.id} kind="task" id={task.id}>{task.title}</RecordHeading>
        <p>{task.completed_at ? `Afgerond op ${timestamp(task.completed_at)}` : task.due_date ? `Voor ${formatDay(task.due_date)}` : "Geen deadline"}</p>
        <Markdown html={task.notes_html} text={task.notes} />
        {task.links.map((link) => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></p>)}
      </article>)}</div> : <p>Geen taken vastgelegd.</p>}
    </Section>
    <Section id="locations" title="Locaties">
      {places.length ? <div className="admin-detail-list">{places.map((place) => <article key={place.id}>
        <div className="admin-detail-heading"><h3>{placeLabel(place)}</h3><Link className="action-link compact" to={`/trips/${encodeURIComponent(trip.id)}/plan`}>Naar planning</Link></div>
        <Markdown html={place.notes_html} text={place.notes} />
        {place.latitude != null && place.longitude != null && <p>Coördinaten: {place.latitude}, {place.longitude}</p>}
      </article>)}</div> : <p>Geen locaties vastgelegd.</p>}
    </Section>
    <Section id="areas" title="Gebieden">
      {areas.length ? <div className="admin-detail-list">{areas.map((place) => <article key={place.id}>
        <RecordHeading tripId={trip.id} kind="area" id={place.id}>{place.label}</RecordHeading>
        <p>{[place.region, place.country_code].filter(Boolean).join(" · ")}</p>
      </article>)}</div> : <p>Nog geen gebieden vastgelegd.</p>}
    </Section>
    <Section id="documents" title="Privédocumenten">
      {documents.length ? <div className="admin-detail-list">{documents.map((document) => <article key={document.id}>
        <RecordHeading tripId={trip.id} kind="document" id={document.id}>{document.title}</RecordHeading>
        <p>{DOCUMENT_KIND_LABELS[document.document_kind]} · {document.original_filename ?? "Naamloos bestand"} · {bytesLabel(document.byte_size)}</p>
        <button className="secondary compact" type="button" onClick={() => openFile(document.file_url, "Het private document kon niet worden geopend.")}>Document openen</button>
      </article>)}</div> : <p>Geen privédocumenten vastgelegd.</p>}
    </Section>
    <Section id="media" title="Privémedia">
      {media.length ? <div className="admin-detail-list">{media.map((asset) => <article key={asset.id}>
        <RecordHeading tripId={trip.id} kind="media" id={asset.id}>{asset.original_filename ?? "Naamloos medium"}</RecordHeading>
        <p>{MEDIA_KIND_LABELS[asset.media_kind]} · {bytesLabel(asset.byte_size)} · vastgelegd {timestamp(asset.captured_at)}</p>
        {asset.gps && <p>GPS: {asset.gps.latitude}, {asset.gps.longitude}</p>}
        <button className="secondary compact" type="button" onClick={() => openFile(asset.file_url, "De privemedia konden niet worden geopend.")}>Media openen</button>
      </article>)}</div> : <p>Geen privémedia vastgelegd.</p>}
    </Section>
  </main>;
}
