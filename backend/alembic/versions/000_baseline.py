"""Current Travel schema baseline, replacing revisions 0001 through 0030.

Revision ID: 000_baseline
Revises:
Create Date: 2026-09-25
"""

from alembic import op

revision = "000_baseline"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_SQL = """\
CREATE TYPE public.travel_audit_event_kind AS ENUM (
    'public_projection.publish',
    'public_projection.unpublish',
    'share_link.create',
    'share_link.activate',
    'share_link.revoke',
    'share_link.rotate',
    'share_link.expire'
);

CREATE TYPE public.travel_audit_target_type AS ENUM (
    'public_surface',
    'share_link'
);

CREATE TYPE public.travel_date_precision AS ENUM (
    'day',
    'month',
    'year'
);

CREATE TYPE public.travel_derivative_purpose AS ENUM (
    'owner_preview',
    'share',
    'static_export'
);

CREATE TYPE public.travel_derivative_review_state AS ENUM (
    'pending',
    'approved'
);

CREATE TYPE public.travel_document_kind AS ENUM (
    'booking',
    'itinerary',
    'receipt',
    'other'
);

CREATE TYPE public.travel_emergency_info_kind AS ENUM (
    'contact',
    'number',
    'medical_note'
);

CREATE TYPE public.travel_import_provider AS ENUM (
    'direct_device',
    'google_photos_picker',
    'gopro_cloud'
);

CREATE TYPE public.travel_import_session_state AS ENUM (
    'pending',
    'completed',
    'expired'
);

CREATE TYPE public.travel_import_state AS ENUM (
    'pending',
    'completed',
    'failed'
);

CREATE TYPE public.travel_itinerary_entry_kind AS ENUM (
    'travel',
    'free',
    'work'
);

CREATE TYPE public.travel_itinerary_link_kind AS ENUM (
    'stay',
    'transport_leg',
    'route_stage',
    'place',
    'document',
    'travel_update'
);

CREATE TYPE public.travel_link_state AS ENUM (
    'draft',
    'active',
    'revoked',
    'expired'
);

CREATE TYPE public.travel_media_kind AS ENUM (
    'photo',
    'video'
);

CREATE TYPE public.travel_object_state AS ENUM (
    'staged',
    'available',
    'quarantined',
    'purge_pending'
);

CREATE TYPE public.travel_place_kind AS ENUM (
    'exact',
    'broad'
);

CREATE TYPE public.travel_stay_status AS ENUM (
    'planned',
    'booked',
    'confirmed',
    'cancelled'
);

CREATE TYPE public.travel_surface_state AS ENUM (
    'unpublished',
    'published'
);

CREATE TYPE public.travel_track_kind AS ENUM (
    'gpx',
    'point_array'
);

CREATE TYPE public.travel_transport_leg_kind AS ENUM (
    'flight',
    'train',
    'bus',
    'ferry',
    'car',
    'other'
);

CREATE TYPE public.travel_transport_leg_status AS ENUM (
    'planned',
    'booked',
    'confirmed',
    'cancelled'
);

CREATE TYPE public.travel_visibility AS ENUM (
    'private',
    'everyone',
    'custom'
);

CREATE TABLE public.audit_events (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    actor_subject character varying(255) NOT NULL,
    kind public.travel_audit_event_kind NOT NULL,
    target_type public.travel_audit_target_type NOT NULL,
    target_id character varying(32) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    details json NOT NULL
);

CREATE TABLE public.broad_routes (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    label character varying(160) NOT NULL,
    geometry json NOT NULL,
    date_precision public.travel_date_precision NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    visibility public.travel_visibility NOT NULL
);

CREATE TABLE public.document_assets (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    original_object_id character varying(32) NOT NULL,
    document_kind public.travel_document_kind NOT NULL,
    title character varying(160) NOT NULL,
    owner_metadata json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.document_derivatives (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    document_asset_id character varying(32) NOT NULL,
    object_id character varying(32) NOT NULL,
    redaction_manifest_object_id character varying(32) NOT NULL,
    review_state public.travel_derivative_review_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    visibility public.travel_visibility NOT NULL
);

CREATE TABLE public.emergency_info_entries (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    kind public.travel_emergency_info_kind NOT NULL,
    label character varying(160) NOT NULL,
    value character varying(255) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.import_records (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    provider public.travel_import_provider NOT NULL,
    provider_item_id character varying(255) NOT NULL,
    state public.travel_import_state NOT NULL,
    media_asset_id character varying(32),
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    failure_code character varying(120)
);

CREATE TABLE public.import_sessions (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    provider public.travel_import_provider NOT NULL,
    provider_session_id character varying(255) NOT NULL,
    state public.travel_import_session_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone
);

CREATE TABLE public.itinerary_entries (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    "position" integer NOT NULL,
    day_date date,
    title character varying(160) NOT NULL,
    notes text,
    linked_kind public.travel_itinerary_link_kind,
    linked_id character varying(32),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    end_date date,
    kind public.travel_itinerary_entry_kind,
    tentative boolean DEFAULT false NOT NULL
);

CREATE TABLE public.mcp_audit_events (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    action character varying(120) NOT NULL,
    resource_type character varying(80) NOT NULL,
    resource_id character varying(64),
    trip_id character varying(32),
    result character varying(16) NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    details json NOT NULL
);

CREATE TABLE public.media_assets (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    original_object_id character varying(32) NOT NULL,
    media_kind public.travel_media_kind NOT NULL,
    captured_at timestamp with time zone,
    import_id character varying(32),
    raw_metadata json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.media_derivatives (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    media_asset_id character varying(32) NOT NULL,
    object_id character varying(32) NOT NULL,
    purpose public.travel_derivative_purpose NOT NULL,
    metadata_stripped_at timestamp with time zone,
    review_state public.travel_derivative_review_state NOT NULL,
    width integer,
    height integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    travel_update_id character varying(32),
    caption character varying(500),
    alt_text character varying(300),
    focal_x integer,
    focal_y integer,
    visibility public.travel_visibility NOT NULL
);

CREATE TABLE public.owner_documents (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    original_object_id character varying(32) NOT NULL,
    document_kind public.travel_document_kind NOT NULL,
    title character varying(160) NOT NULL,
    owner_metadata json NOT NULL,
    linked_trip_id character varying(32),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.owner_stored_objects (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    bucket character varying(64) NOT NULL,
    object_key character varying(255) NOT NULL,
    sha256 character varying(64) NOT NULL,
    byte_size integer NOT NULL,
    content_type character varying(120) NOT NULL,
    state public.travel_object_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.places (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    kind public.travel_place_kind NOT NULL,
    label character varying(120),
    region character varying(120),
    country_code character varying(2),
    latitude double precision,
    longitude double precision,
    address_line1 character varying(160),
    address_line2 character varying(160),
    locality character varying(120),
    admin_area character varying(120),
    postal_code character varying(20),
    viewport_north double precision,
    viewport_south double precision,
    viewport_east double precision,
    viewport_west double precision,
    navigation_provider character varying(40),
    navigation_provider_place_id character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    osm_element_type character varying(12),
    osm_element_id character varying(32),
    display_name character varying(500),
    timezone character varying(64),
    visibility public.travel_visibility NOT NULL,
    area_id character varying(32),
    share_address boolean NOT NULL,
    CONSTRAINT ck_places_osm_element_type CHECK (((osm_element_type IS NULL) OR ((osm_element_type)::text = ANY ((ARRAY['node'::character varying, 'way'::character varying, 'relation'::character varying])::text[])))),
    CONSTRAINT ck_places_osm_reference_pair CHECK (((osm_element_type IS NULL) = (osm_element_id IS NULL))),
    CONSTRAINT ck_places_spot_has_area CHECK ((((kind = 'broad'::public.travel_place_kind) AND (area_id IS NULL)) OR ((kind = 'exact'::public.travel_place_kind) AND (area_id IS NOT NULL))))
);

CREATE TABLE public.public_surfaces (
    trip_id character varying(32) NOT NULL,
    slug character varying(32) NOT NULL,
    state public.travel_surface_state NOT NULL,
    scope json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.recorded_tracks (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    source_object_id character varying(32) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    kind public.travel_track_kind NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_track_end_after_start CHECK ((ended_at > started_at))
);

CREATE TABLE public.route_stages (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    broad_place_id character varying(32) NOT NULL,
    "position" integer NOT NULL,
    label character varying(120),
    summary text,
    visibility public.travel_visibility NOT NULL
);

CREATE TABLE public.share_links (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    label character varying(120) NOT NULL,
    state public.travel_link_state NOT NULL,
    scope json NOT NULL,
    token_verifier character varying(64),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    token character varying(128),
    series_id character varying(32) NOT NULL
);

CREATE TABLE public.stays (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    exact_place_id character varying(32),
    status public.travel_stay_status NOT NULL,
    property_name character varying(160),
    booking_reference character varying(255),
    contact_details text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    check_in_date date NOT NULL,
    check_out_date date NOT NULL,
    check_in_time time without time zone,
    check_out_time time without time zone,
    broad_place_id character varying(32),
    website_url character varying(2048),
    visibility public.travel_visibility NOT NULL,
    share_date_precision public.travel_date_precision NOT NULL,
    CONSTRAINT ck_stay_check_out_after_check_in CHECK ((check_out_date > check_in_date))
);

CREATE TABLE public.stored_objects (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    bucket character varying(64) NOT NULL,
    object_key character varying(255) NOT NULL,
    sha256 character varying(64) NOT NULL,
    byte_size integer NOT NULL,
    content_type character varying(120) NOT NULL,
    state public.travel_object_state NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transport_leg_document_assets (
    transport_leg_id character varying(32) NOT NULL,
    document_asset_id character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transport_legs (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    kind public.travel_transport_leg_kind NOT NULL,
    status public.travel_transport_leg_status NOT NULL,
    departure_place_id character varying(32) NOT NULL,
    arrival_place_id character varying(32) NOT NULL,
    departs_at timestamp with time zone NOT NULL,
    arrives_at timestamp with time zone NOT NULL,
    carrier character varying(160),
    service_reference character varying(40),
    booking_reference character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    departure_timezone character varying(64),
    arrival_timezone character varying(64),
    travel_class character varying(80),
    visibility public.travel_visibility NOT NULL,
    CONSTRAINT ck_transport_leg_arrival_after_departure CHECK ((arrives_at > departs_at))
);

CREATE TABLE public.travel_update_media_assets (
    travel_update_id character varying(32) CONSTRAINT moment_media_assets_moment_id_not_null NOT NULL,
    media_asset_id character varying(32) CONSTRAINT moment_media_assets_media_asset_id_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT moment_media_assets_created_at_not_null NOT NULL
);

CREATE TABLE public.travel_updates (
    id character varying(32) CONSTRAINT moment_excerpts_id_not_null NOT NULL,
    trip_id character varying(32) CONSTRAINT moment_excerpts_trip_id_not_null NOT NULL,
    broad_place_id character varying(32),
    date_precision public.travel_date_precision CONSTRAINT moment_excerpts_date_precision_not_null NOT NULL,
    title character varying(160) CONSTRAINT moment_excerpts_title_not_null NOT NULL,
    body text CONSTRAINT moment_excerpts_body_not_null NOT NULL,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT moment_excerpts_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT moment_excerpts_updated_at_not_null NOT NULL,
    share_id character varying(32) CONSTRAINT moment_excerpts_share_id_not_null NOT NULL,
    visibility public.travel_visibility CONSTRAINT moment_excerpts_visibility_not_null NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    exact_place_id character varying(32),
    private_notes text
);

CREATE TABLE public.trip_task_alerts (
    id character varying(32) NOT NULL,
    task_id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    kind character varying(32) NOT NULL,
    title character varying(200) NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    email_sent_at timestamp with time zone,
    email_attempts integer DEFAULT 0 NOT NULL,
    email_last_error character varying(120)
);

CREATE TABLE public.trip_tasks (
    id character varying(32) NOT NULL,
    trip_id character varying(32) NOT NULL,
    title character varying(160) NOT NULL,
    notes text,
    due_date date,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    links json DEFAULT '[]'::json NOT NULL,
    remind_at timestamp with time zone,
    reminded_at timestamp with time zone
);

CREATE TABLE public.trips (
    id character varying(32) NOT NULL,
    owner_subject character varying(255) NOT NULL,
    title character varying(160) NOT NULL,
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    starts_on date,
    ends_on date
);

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.broad_routes
    ADD CONSTRAINT broad_routes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.document_assets
    ADD CONSTRAINT document_assets_original_object_id_key UNIQUE (original_object_id);

ALTER TABLE ONLY public.document_assets
    ADD CONSTRAINT document_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_object_id_key UNIQUE (object_id);

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_redaction_manifest_object_id_key UNIQUE (redaction_manifest_object_id);

ALTER TABLE ONLY public.emergency_info_entries
    ADD CONSTRAINT emergency_info_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_records
    ADD CONSTRAINT import_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_sessions
    ADD CONSTRAINT import_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.itinerary_entries
    ADD CONSTRAINT itinerary_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_audit_events
    ADD CONSTRAINT mcp_audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_original_object_id_key UNIQUE (original_object_id);

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_object_id_key UNIQUE (object_id);

ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.travel_updates
    ADD CONSTRAINT moment_excerpts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.owner_documents
    ADD CONSTRAINT owner_documents_original_object_id_key UNIQUE (original_object_id);

ALTER TABLE ONLY public.owner_documents
    ADD CONSTRAINT owner_documents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.owner_stored_objects
    ADD CONSTRAINT owner_stored_objects_object_key_key UNIQUE (object_key);

ALTER TABLE ONLY public.owner_stored_objects
    ADD CONSTRAINT owner_stored_objects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.places
    ADD CONSTRAINT places_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.public_surfaces
    ADD CONSTRAINT public_surfaces_pkey PRIMARY KEY (trip_id);

ALTER TABLE ONLY public.public_surfaces
    ADD CONSTRAINT public_surfaces_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.recorded_tracks
    ADD CONSTRAINT recorded_tracks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.recorded_tracks
    ADD CONSTRAINT recorded_tracks_source_object_id_key UNIQUE (source_object_id);

ALTER TABLE ONLY public.route_stages
    ADD CONSTRAINT route_stages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.share_links
    ADD CONSTRAINT share_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.share_links
    ADD CONSTRAINT share_links_token_verifier_key UNIQUE (token_verifier);

ALTER TABLE ONLY public.stays
    ADD CONSTRAINT stays_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.stored_objects
    ADD CONSTRAINT stored_objects_object_key_key UNIQUE (object_key);

ALTER TABLE ONLY public.stored_objects
    ADD CONSTRAINT stored_objects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transport_leg_document_assets
    ADD CONSTRAINT transport_leg_document_assets_pkey PRIMARY KEY (transport_leg_id, document_asset_id);

ALTER TABLE ONLY public.transport_legs
    ADD CONSTRAINT transport_legs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.travel_update_media_assets
    ADD CONSTRAINT travel_update_media_assets_pkey PRIMARY KEY (travel_update_id, media_asset_id);

ALTER TABLE ONLY public.trip_task_alerts
    ADD CONSTRAINT trip_task_alerts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trip_tasks
    ADD CONSTRAINT trip_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.trips
    ADD CONSTRAINT trips_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.import_records
    ADD CONSTRAINT uq_import_record_provider_item UNIQUE (trip_id, provider, provider_item_id);

ALTER TABLE ONLY public.itinerary_entries
    ADD CONSTRAINT uq_itinerary_entry_position UNIQUE (trip_id, "position");

ALTER TABLE ONLY public.owner_stored_objects
    ADD CONSTRAINT uq_owner_stored_object_owner_sha256 UNIQUE (owner_subject, sha256);

ALTER TABLE ONLY public.route_stages
    ADD CONSTRAINT uq_route_stage_position UNIQUE (trip_id, "position");

ALTER TABLE ONLY public.stored_objects
    ADD CONSTRAINT uq_stored_object_trip_sha256 UNIQUE (trip_id, sha256);

ALTER TABLE ONLY public.travel_updates
    ADD CONSTRAINT uq_travel_updates_share_id UNIQUE (share_id);

ALTER TABLE ONLY public.trip_task_alerts
    ADD CONSTRAINT uq_trip_task_alert_schedule UNIQUE (task_id, kind, scheduled_for);

CREATE INDEX ix_audit_events_trip_id ON public.audit_events USING btree (trip_id);

CREATE INDEX ix_broad_routes_trip_id ON public.broad_routes USING btree (trip_id);

CREATE INDEX ix_document_assets_trip_id ON public.document_assets USING btree (trip_id);

CREATE INDEX ix_document_derivatives_document_asset_id ON public.document_derivatives USING btree (document_asset_id);

CREATE INDEX ix_document_derivatives_trip_id ON public.document_derivatives USING btree (trip_id);

CREATE INDEX ix_emergency_info_entries_owner_subject ON public.emergency_info_entries USING btree (owner_subject);

CREATE INDEX ix_import_records_trip_id ON public.import_records USING btree (trip_id);

CREATE INDEX ix_import_sessions_trip_id ON public.import_sessions USING btree (trip_id);

CREATE INDEX ix_itinerary_entries_trip_id ON public.itinerary_entries USING btree (trip_id);

CREATE INDEX ix_mcp_audit_events_owner_subject ON public.mcp_audit_events USING btree (owner_subject);

CREATE INDEX ix_mcp_audit_events_trip_id ON public.mcp_audit_events USING btree (trip_id);

CREATE INDEX ix_media_assets_trip_id ON public.media_assets USING btree (trip_id);

CREATE INDEX ix_media_derivatives_media_asset_id ON public.media_derivatives USING btree (media_asset_id);

CREATE INDEX ix_media_derivatives_trip_id ON public.media_derivatives USING btree (trip_id);

CREATE INDEX ix_owner_documents_linked_trip_id ON public.owner_documents USING btree (linked_trip_id);

CREATE INDEX ix_owner_documents_owner_subject ON public.owner_documents USING btree (owner_subject);

CREATE INDEX ix_owner_stored_objects_owner_subject ON public.owner_stored_objects USING btree (owner_subject);

CREATE INDEX ix_places_osm_element ON public.places USING btree (osm_element_type, osm_element_id);

CREATE INDEX ix_places_trip_id ON public.places USING btree (trip_id);

CREATE INDEX ix_recorded_tracks_trip_id ON public.recorded_tracks USING btree (trip_id);

CREATE INDEX ix_route_stages_trip_id ON public.route_stages USING btree (trip_id);

CREATE INDEX ix_share_links_series_id ON public.share_links USING btree (series_id);

CREATE INDEX ix_share_links_trip_id ON public.share_links USING btree (trip_id);

CREATE INDEX ix_stays_trip_id ON public.stays USING btree (trip_id);

CREATE INDEX ix_stored_objects_trip_id ON public.stored_objects USING btree (trip_id);

CREATE INDEX ix_transport_leg_document_assets_document_asset_id ON public.transport_leg_document_assets USING btree (document_asset_id);

CREATE INDEX ix_transport_legs_trip_id ON public.transport_legs USING btree (trip_id);

CREATE INDEX ix_travel_update_media_assets_media_asset_id ON public.travel_update_media_assets USING btree (media_asset_id);

CREATE INDEX ix_travel_updates_trip_id ON public.travel_updates USING btree (trip_id);

CREATE INDEX ix_trip_task_alerts_owner_subject ON public.trip_task_alerts USING btree (owner_subject);

CREATE INDEX ix_trip_task_alerts_task_id ON public.trip_task_alerts USING btree (task_id);

CREATE INDEX ix_trip_tasks_trip_id ON public.trip_tasks USING btree (trip_id);

CREATE INDEX ix_trips_owner_subject ON public.trips USING btree (owner_subject);

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.broad_routes
    ADD CONSTRAINT broad_routes_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_assets
    ADD CONSTRAINT document_assets_original_object_id_fkey FOREIGN KEY (original_object_id) REFERENCES public.stored_objects(id);

ALTER TABLE ONLY public.document_assets
    ADD CONSTRAINT document_assets_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_document_asset_id_fkey FOREIGN KEY (document_asset_id) REFERENCES public.document_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_object_id_fkey FOREIGN KEY (object_id) REFERENCES public.stored_objects(id);

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_redaction_manifest_object_id_fkey FOREIGN KEY (redaction_manifest_object_id) REFERENCES public.stored_objects(id);

ALTER TABLE ONLY public.document_derivatives
    ADD CONSTRAINT document_derivatives_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.import_records
    ADD CONSTRAINT fk_import_records_media_asset_id FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT fk_media_derivatives_travel_update_id FOREIGN KEY (travel_update_id) REFERENCES public.travel_updates(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.places
    ADD CONSTRAINT fk_places_area_id FOREIGN KEY (area_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.stays
    ADD CONSTRAINT fk_stays_broad_place_id_places FOREIGN KEY (broad_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.travel_update_media_assets
    ADD CONSTRAINT fk_travel_update_media_assets_travel_update_id FOREIGN KEY (travel_update_id) REFERENCES public.travel_updates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.travel_updates
    ADD CONSTRAINT fk_travel_updates_exact_place_id FOREIGN KEY (exact_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.import_records
    ADD CONSTRAINT import_records_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.import_sessions
    ADD CONSTRAINT import_sessions_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.itinerary_entries
    ADD CONSTRAINT itinerary_entries_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.import_records(id);

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_original_object_id_fkey FOREIGN KEY (original_object_id) REFERENCES public.stored_objects(id);

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_media_asset_id_fkey FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_object_id_fkey FOREIGN KEY (object_id) REFERENCES public.stored_objects(id);

ALTER TABLE ONLY public.media_derivatives
    ADD CONSTRAINT media_derivatives_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.travel_updates
    ADD CONSTRAINT moment_excerpts_broad_place_id_fkey FOREIGN KEY (broad_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.travel_updates
    ADD CONSTRAINT moment_excerpts_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.travel_update_media_assets
    ADD CONSTRAINT moment_media_assets_media_asset_id_fkey FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.owner_documents
    ADD CONSTRAINT owner_documents_linked_trip_id_fkey FOREIGN KEY (linked_trip_id) REFERENCES public.trips(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.owner_documents
    ADD CONSTRAINT owner_documents_original_object_id_fkey FOREIGN KEY (original_object_id) REFERENCES public.owner_stored_objects(id);

ALTER TABLE ONLY public.places
    ADD CONSTRAINT places_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.public_surfaces
    ADD CONSTRAINT public_surfaces_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.recorded_tracks
    ADD CONSTRAINT recorded_tracks_source_object_id_fkey FOREIGN KEY (source_object_id) REFERENCES public.stored_objects(id);

ALTER TABLE ONLY public.recorded_tracks
    ADD CONSTRAINT recorded_tracks_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.route_stages
    ADD CONSTRAINT route_stages_broad_place_id_fkey FOREIGN KEY (broad_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.route_stages
    ADD CONSTRAINT route_stages_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.share_links
    ADD CONSTRAINT share_links_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stays
    ADD CONSTRAINT stays_exact_place_id_fkey FOREIGN KEY (exact_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.stays
    ADD CONSTRAINT stays_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.stored_objects
    ADD CONSTRAINT stored_objects_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transport_leg_document_assets
    ADD CONSTRAINT transport_leg_document_assets_document_asset_id_fkey FOREIGN KEY (document_asset_id) REFERENCES public.document_assets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transport_leg_document_assets
    ADD CONSTRAINT transport_leg_document_assets_transport_leg_id_fkey FOREIGN KEY (transport_leg_id) REFERENCES public.transport_legs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transport_legs
    ADD CONSTRAINT transport_legs_arrival_place_id_fkey FOREIGN KEY (arrival_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.transport_legs
    ADD CONSTRAINT transport_legs_departure_place_id_fkey FOREIGN KEY (departure_place_id) REFERENCES public.places(id);

ALTER TABLE ONLY public.transport_legs
    ADD CONSTRAINT transport_legs_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.trip_task_alerts
    ADD CONSTRAINT trip_task_alerts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.trip_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.trip_tasks
    ADD CONSTRAINT trip_tasks_trip_id_fkey FOREIGN KEY (trip_id) REFERENCES public.trips(id) ON DELETE CASCADE;
"""


def upgrade() -> None:
    # Frozen DDL from the validated production schema. Execute each statement
    # separately so this works with psycopg's prepared-statement protocol.
    for statement in SCHEMA_SQL.split(";\n\n"):
        statement = statement.strip().removesuffix(";")
        if statement:
            op.get_bind().exec_driver_sql(statement)


def downgrade() -> None:
    # The baseline is the complete application schema. Dropping it returns a
    # fresh database to Alembic base, as required by the migration CI job.
    op.execute("DROP TABLE public.trips CASCADE")
    op.execute("DROP TABLE public.trip_tasks CASCADE")
    op.execute("DROP TABLE public.trip_task_alerts CASCADE")
    op.execute("DROP TABLE public.travel_updates CASCADE")
    op.execute("DROP TABLE public.travel_update_media_assets CASCADE")
    op.execute("DROP TABLE public.transport_legs CASCADE")
    op.execute("DROP TABLE public.transport_leg_document_assets CASCADE")
    op.execute("DROP TABLE public.stored_objects CASCADE")
    op.execute("DROP TABLE public.stays CASCADE")
    op.execute("DROP TABLE public.share_links CASCADE")
    op.execute("DROP TABLE public.route_stages CASCADE")
    op.execute("DROP TABLE public.recorded_tracks CASCADE")
    op.execute("DROP TABLE public.public_surfaces CASCADE")
    op.execute("DROP TABLE public.places CASCADE")
    op.execute("DROP TABLE public.owner_stored_objects CASCADE")
    op.execute("DROP TABLE public.owner_documents CASCADE")
    op.execute("DROP TABLE public.media_derivatives CASCADE")
    op.execute("DROP TABLE public.media_assets CASCADE")
    op.execute("DROP TABLE public.mcp_audit_events CASCADE")
    op.execute("DROP TABLE public.itinerary_entries CASCADE")
    op.execute("DROP TABLE public.import_sessions CASCADE")
    op.execute("DROP TABLE public.import_records CASCADE")
    op.execute("DROP TABLE public.emergency_info_entries CASCADE")
    op.execute("DROP TABLE public.document_derivatives CASCADE")
    op.execute("DROP TABLE public.document_assets CASCADE")
    op.execute("DROP TABLE public.broad_routes CASCADE")
    op.execute("DROP TABLE public.audit_events CASCADE")
    op.execute("DROP TYPE public.travel_visibility")
    op.execute("DROP TYPE public.travel_transport_leg_status")
    op.execute("DROP TYPE public.travel_transport_leg_kind")
    op.execute("DROP TYPE public.travel_track_kind")
    op.execute("DROP TYPE public.travel_surface_state")
    op.execute("DROP TYPE public.travel_stay_status")
    op.execute("DROP TYPE public.travel_place_kind")
    op.execute("DROP TYPE public.travel_object_state")
    op.execute("DROP TYPE public.travel_media_kind")
    op.execute("DROP TYPE public.travel_link_state")
    op.execute("DROP TYPE public.travel_itinerary_link_kind")
    op.execute("DROP TYPE public.travel_itinerary_entry_kind")
    op.execute("DROP TYPE public.travel_import_state")
    op.execute("DROP TYPE public.travel_import_session_state")
    op.execute("DROP TYPE public.travel_import_provider")
    op.execute("DROP TYPE public.travel_emergency_info_kind")
    op.execute("DROP TYPE public.travel_document_kind")
    op.execute("DROP TYPE public.travel_derivative_review_state")
    op.execute("DROP TYPE public.travel_derivative_purpose")
    op.execute("DROP TYPE public.travel_date_precision")
    op.execute("DROP TYPE public.travel_audit_target_type")
    op.execute("DROP TYPE public.travel_audit_event_kind")
