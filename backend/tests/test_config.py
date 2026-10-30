import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.mark.parametrize("environment", ["production", "test", "staging", "Development"])
def test_startup_refuses_default_share_link_secret_outside_development(environment: str) -> None:
    with pytest.raises(ValidationError, match="TRAVEL_SHARE_LINK_SECRET"):
        Settings(environment=environment, share_link_secret="development-only-change-me")


def test_startup_accepts_default_share_link_secret_in_development() -> None:
    assert Settings(environment="development", share_link_secret="development-only-change-me")


def test_startup_accepts_configured_production_share_link_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TRAVEL_ENVIRONMENT", "production")
    monkeypatch.setenv("TRAVEL_SHARE_LINK_SECRET", "synthetic-test-secret")
    monkeypatch.delenv("TRAVEL_DEV_AUTH_BYPASS_TOKEN", raising=False)
    monkeypatch.setenv("TRAVEL_OSM_PLACE_SEARCH_USER_AGENT", "Travel/0.1 (contact: ops@example.test)")
    assert Settings().share_link_secret == "synthetic-test-secret"


def test_startup_defaults_to_production_and_requires_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("TRAVEL_ENVIRONMENT", "TRAVEL_SHARE_LINK_SECRET", "TRAVEL_DEV_AUTH_BYPASS_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValidationError, match="TRAVEL_SHARE_LINK_SECRET"):
        Settings()


@pytest.mark.parametrize("agent", ["Travel/0.1", "", "Travel/0.1 (private place search)"])
def test_production_requires_geocoder_contact(agent: str) -> None:
    with pytest.raises(ValidationError, match="TRAVEL_OSM_PLACE_SEARCH_USER_AGENT"):
        Settings(environment="production", share_link_secret="synthetic", osm_place_search_user_agent=agent)


@pytest.mark.parametrize("contact", ["ops@example.test", "https://example.test/contact"])
def test_production_accepts_geocoder_contact(contact: str) -> None:
    assert Settings(
        environment="production",
        share_link_secret="synthetic",
        osm_place_search_user_agent=f"Travel/0.1 ({contact})",
    )
