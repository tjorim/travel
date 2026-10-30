from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from test_publication import client_for, create_trip, engine

from app.database import Base
from app.main import app
from app.places.search import CachedPlaceSearchService, PlaceSearchBusy, PlaceSearchError, get_place_search_service


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


class Provider:
    name = "synthetic"
    attribution = "Synthetic"
    attribution_url = "https://example.test"

    def search(self, query):
        return []

    def reverse(self, latitude, longitude):
        return None


def test_spacing_cache_and_reverse_share_budget(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("app.places.search.monotonic", lambda: clock[0])
    service = CachedPlaceSearchService(Provider())
    assert service.search("first").results == []
    assert service.search(" first ").results == []
    clock[0] = 100.9
    with pytest.raises(PlaceSearchBusy):
        service.reverse(1, 2)
    clock[0] = 101.0
    assert service.reverse(1, 2).results == []


def test_concurrent_misses_never_overlap_and_cache_remains_available():
    entered, release = Event(), Event()

    class BlockingProvider(Provider):
        def search(self, query):
            if query == "blocked":
                entered.set()
                assert release.wait(5)
            return []

    service = CachedPlaceSearchService(BlockingProvider())
    service.search("cached")
    service._next_request_at = 0
    with ThreadPoolExecutor() as executor:
        pending = executor.submit(service.search, "blocked")
        try:
            assert entered.wait(5)
            assert service.search("cached").results == []
            with pytest.raises(PlaceSearchBusy):
                service.search("another")
        finally:
            release.set()
        pending.result()


@pytest.mark.parametrize("failure,status", [(PlaceSearchBusy(), 429), (PlaceSearchError("Unavailable"), 503)])
def test_owner_receives_retry_after(failure, status):
    owner = client_for("owner-1")
    trip = create_trip(owner)

    class FailedService:
        def search(self, query):
            raise failure

    app.dependency_overrides[get_place_search_service] = FailedService
    try:
        response = owner.post(f"/api/trips/{trip['id']}/places/search", json={"query": "Synthetic"})
        assert response.status_code == status
        assert response.headers["retry-after"] == "1"
    finally:
        app.dependency_overrides.clear()
