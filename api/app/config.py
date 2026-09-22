from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "production"
    database_url: str = "sqlite:///./travel-api.db"
    oidc_issuer_url: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str = "travel-api"
    allow_development_subject_header: bool = False
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
    # The GoPro Cloud beta API is not generally available. The adapter exists
    # behind this flag so the product remains fully usable without it; no
    # code path may require it.
    gopro_cloud_enabled: bool = False
    google_photos_picker_api_base: str = "https://photospicker.googleapis.com/v1"
    gopro_cloud_api_base: str = "https://api.gopro.com/cloud/v1"

    model_config = SettingsConfigDict(env_prefix="TRAVEL_", case_sensitive=False)


settings = Settings()
