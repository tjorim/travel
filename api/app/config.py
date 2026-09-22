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

    model_config = SettingsConfigDict(env_prefix="TRAVEL_", case_sensitive=False)


settings = Settings()
