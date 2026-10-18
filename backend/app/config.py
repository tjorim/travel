from typing import Literal

from cryptography.fernet import Fernet
from limits import parse_many
from pydantic import AnyHttpUrl, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "production"
    database_url: str = "sqlite:///./travel-api.db"
    oidc_issuer_url: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str = "travel-api"
    # Local-development-only shortcut that skips OIDC/JWKS verification: a
    # request whose bearer token equals this value is the fixed development
    # owner (app.auth.DEV_BYPASS_SUBJECT). Empty by default; startup refuses
    # it outside environment == "development". Same contract as the
    # DEV_AUTH_BYPASS_TOKEN of champagnefestival and worktime.
    dev_auth_bypass_token: str = ""
    # The canonical public URL of the MCP resource, for example
    # https://travel.example.test/mcp.  It is advertised verbatim as the
    # protected-resource identifier (RFC 9728/8707) and, unless
    # mcp_audience overrides it, is the only audience MCP accepts.  Ordinary
    # API tokens (oidc_audience) never authenticate MCP and the reverse.
    # In development a named subject makes stdio integration tests possible
    # without weakening production authentication.
    mcp_base_url: str | None = None
    mcp_audience: str | None = None
    mcp_development_subject: str | None = None
    # The visitor-facing PWA origin. MCP runs without an HTTP request from
    # which it could otherwise determine where an unlisted visitor URL lives.
    # This points to Vite's default local origin in development; deployment
    # must set it to the public Travel application origin.
    public_app_url: AnyHttpUrl = AnyHttpUrl("http://localhost:5173")
    # Explicit per-owner delivery mapping prevents one owner's private task
    # title from being mailed to another owner's address.
    task_alert_recipients: dict[str, str] = Field(default_factory=dict)
    task_alert_smtp_host: str | None = None
    task_alert_smtp_port: int = 587
    task_alert_smtp_username: str | None = None
    task_alert_smtp_password: str | None = None
    task_alert_email_from: str | None = None
    # Keys the one-way verifier stored for each unlisted share-link capability.
    # The raw token is never stored; only a party holding this secret can
    # recognize a presented token as valid. Must be overridden in production.
    share_link_secret: str = "development-only-change-me"

    # Filesystem root for the local object-storage adapter. Production points
    # this at the backed-up VPS media volume; it is never a path inside Git.
    media_storage_root: str = "./media-storage"
    # Refuses a direct upload or a single provider-imported item larger than
    # this many bytes, before any bytes are written to storage.
    media_max_upload_bytes: int = 200 * 1024 * 1024
    # Explicit choice for NEW derivatives only; outstanding remote jobs always reconcile remotely.
    video_processing_backend: Literal["local", "remote"] = "local"
    media_worker_url: str = ""
    media_worker_token_file: str = "/run/secrets/media_travel_token"
    media_worker_profile: Literal["travel-video-v1"] = "travel-video-v1"
    # The GoPro Cloud beta API is not generally available. The adapter exists
    # behind this flag so the product remains fully usable without it; no
    # code path may require it.
    gopro_cloud_enabled: bool = False
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: str | None = None
    # Fernet key, kept outside Git and shared by every API process.
    provider_secret_key: str | None = None
    google_oauth_redirect_uri: str | None = None
    google_photos_picker_api_base: str = "https://photospicker.googleapis.com/v1"
    gopro_cloud_api_base: str = "https://api.gopro.com/cloud/v1"

    # Place search is owner-only.  The provider is deliberately named rather
    # than hard-coded so a self-hosted or contracted provider can replace
    # Nominatim without changing the HTTP contract.
    osm_place_search_provider: str = "nominatim"
    osm_place_search_api_base: str = "https://nominatim.openstreetmap.org"
    osm_place_search_user_agent: str = "Travel/0.1 (private place search)"
    osm_place_search_timeout_seconds: float = 5.0
    osm_place_search_cache_ttl_seconds: int = 300
    osm_place_search_cache_max_entries: int = 100

    # Base URL of the self-hosted LibreTranslate instance (tjorim/apps#252),
    # reached only over the internal network. Unset disables draft translation.
    # The service starts on demand, so the timeout must cover a cold start
    # (about 15-30 s) plus the translation of one paragraph-sized request.
    translation_api_base: str | None = None
    translation_timeout_seconds: float = 120.0
    # One owner request is sent to the CPU-bound service in requests of about
    # this many characters, one at a time.
    translation_segment_characters: int = 1000

    # Per-client limits on the unauthenticated visitor delivery endpoints (#370), in "limits" notation such as
    # "300/minute" or "30/minute;300/hour". A published trip page fetches its files and map links one by one, so
    # these allow a busy page while still bounding bulk requests; an unlisted link, whose token can be probed,
    # gets the stricter default. Counters are in-process (see app.ratelimit).
    rate_limit_enabled: bool = True
    rate_limit_default: str = "300/minute"
    rate_limit_shared: str = "120/minute"

    model_config = SettingsConfigDict(env_prefix="TRAVEL_", case_sensitive=False)

    @field_validator("rate_limit_default", "rate_limit_shared")
    @classmethod
    def validate_rate_limit_notation(cls, value: str) -> str:
        parse_many(value)
        return value

    @model_validator(mode="after")
    def validate_no_dev_bypass_outside_development(self) -> "Settings":
        if self.dev_auth_bypass_token and self.environment != "development":
            raise ValueError("TRAVEL_DEV_AUTH_BYPASS_TOKEN must not be set outside TRAVEL_ENVIRONMENT=development.")
        if self.provider_secret_key:
            Fernet(self.provider_secret_key.encode())
        return self

    @property
    def mcp_resource_url(self) -> str | None:
        """The canonical MCP resource URL, without a trailing slash."""
        return self.mcp_base_url.rstrip("/") if self.mcp_base_url else None

    @property
    def mcp_token_audience(self) -> str | None:
        """The one audience an MCP bearer token must carry."""
        return self.mcp_audience or self.mcp_resource_url

    @model_validator(mode="after")
    def validate_mcp_audience_is_not_the_api_audience(self) -> "Settings":
        if self.mcp_token_audience and self.mcp_token_audience == self.oidc_audience:
            raise ValueError("TRAVEL_MCP_AUDIENCE must differ from TRAVEL_OIDC_AUDIENCE.")
        return self


settings = Settings()
