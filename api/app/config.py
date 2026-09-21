from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: str = "production"
    database_url: str = "sqlite:///./travel-api.db"
    oidc_issuer_url: str | None = None
    oidc_jwks_url: str | None = None
    oidc_audience: str = "travel-api"
    allow_development_subject_header: bool = False

    model_config = SettingsConfigDict(env_prefix="TRAVEL_", case_sensitive=False)


settings = Settings()
