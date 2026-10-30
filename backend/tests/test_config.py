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
    assert Settings().share_link_secret == "synthetic-test-secret"


def test_startup_defaults_to_production_and_requires_a_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("TRAVEL_ENVIRONMENT", "TRAVEL_SHARE_LINK_SECRET", "TRAVEL_DEV_AUTH_BYPASS_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValidationError, match="TRAVEL_SHARE_LINK_SECRET"):
        Settings()
