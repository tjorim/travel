"""Owner-only, replaceable OSM place search.

Search phrases can reveal sensitive destinations.  They are sent only to the
configured provider over HTTPS, are never logged, and live only in a bounded
in-process TTL cache.  The cache is intentionally not persistent: a database
cache would retain a searchable history of confidential owner queries.

A result also carries the provider's names for the place (``namedetails``): its local name and its Dutch and
English names, offered to the owner and stored only if the owner saves them (see ``_names`` and
``docs/place-search-provider.md``).
"""

from collections import OrderedDict
from dataclasses import dataclass
from functools import lru_cache
from math import ceil
from threading import Lock
from time import monotonic
from typing import Protocol
from urllib.parse import urlsplit

import httpx

from ..config import Settings, settings
from ..errors import ServiceError
from ..schemas import PlaceSearchResponse, PlaceSearchResult

NOMINATIM_ATTRIBUTION = "© OpenStreetMap contributors"
NOMINATIM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright"


class PlaceSearchError(ServiceError, RuntimeError):
    """A provider failure that deliberately contains no search query."""

    status_code = 503
    retry_after = 1


class PlaceSearchBusy(PlaceSearchError):
    status_code = 429

    def __init__(self, retry_after: int = 1) -> None:
        super().__init__("Place search is busy; retry later", code="operation_failed")
        self.retry_after = retry_after


class PlaceSearchProvider(Protocol):
    name: str
    attribution: str
    attribution_url: str

    def search(self, query: str) -> list[PlaceSearchResult]: ...

    def reverse(self, latitude: float, longitude: float) -> PlaceSearchResult | None: ...


def _address(data: dict) -> dict[str, str | None]:
    raw_address = data.get("address")
    address = raw_address if isinstance(raw_address, dict) else {}
    road = address.get("road")
    house_number = address.get("house_number")
    line1 = " ".join(value for value in [house_number, road] if isinstance(value, str)) or None
    return {
        "address_line1": line1,
        "address_line2": address.get("neighbourhood") if isinstance(address.get("neighbourhood"), str) else None,
        "locality": next(
            (address[key] for key in ("city", "town", "village", "municipality") if isinstance(address.get(key), str)),
            None,
        ),
        "admin_area": next((address[key] for key in ("state", "county") if isinstance(address.get(key), str)), None),
        "postal_code": address.get("postcode") if isinstance(address.get("postcode"), str) else None,
        "country_code": address.get("country_code", "").upper() or None,
    }


MAX_NAME = 120  # a stored label or local name is at most this long; a longer provider name is not offered


def _name_tag(details: dict, key: str) -> str | None:
    value = details.get(key)
    text = " ".join(value.split()) if isinstance(value, str) else ""
    return text if 0 < len(text) <= MAX_NAME else None


def _names(item: dict) -> dict[str, str | None]:
    """The provider's names for the place itself: its local name and its Dutch and English ones, as suggestions.

    ``display_name`` stays the English reading the request asks for (``accept-language: en``). Next to it the
    provider's ``namedetails`` give the raw OpenStreetMap name tags:

    * ``local_name`` is the plain ``name`` tag, which OpenStreetMap defines as the name used where the place is
      (in the local language and script). It is offered only when it differs from the English name the provider
      returned (the first part of ``display_name``, or ``name:en``): the same text twice is no information. The
      comparison folds case only, so ``Zürich`` stays a local name next to ``Zurich``.
    * ``name_nl`` and ``name_en`` are the ``name:nl`` and ``name:en`` tags, offered as suggestions for the Dutch and
      English labels. A place that has no such tag has no suggestion: nothing is translated or guessed.

    A name longer than a stored one can be is dropped. Nothing here is stored: the owner applies a suggestion."""
    details = item.get("namedetails")
    if not isinstance(details, dict):
        return {}
    name_nl, name_en = _name_tag(details, "name:nl"), _name_tag(details, "name:en")
    local = _name_tag(details, "name")
    shown = {
        name.casefold() for name in (str(item.get("display_name", "")).split(",")[0].strip(), name_en or "") if name
    }
    return {
        "local_name": local if local is not None and local.casefold() not in shown else None,
        "name_nl": name_nl,
        "name_en": name_en,
    }


class NominatimSearchProvider:
    name = "nominatim"
    attribution = NOMINATIM_ATTRIBUTION
    attribution_url = NOMINATIM_ATTRIBUTION_URL

    def __init__(self, config: Settings = settings) -> None:
        self.config = config

    def _request(self, path: str, params: dict[str, str | int | float]) -> object:
        if urlsplit(self.config.osm_place_search_api_base).scheme != "https":
            raise PlaceSearchError("Place search provider must use HTTPS", code="place_search_provider_must_use_https")
        try:
            response = httpx.get(
                f"{self.config.osm_place_search_api_base.rstrip('/')}/{path}",
                params={
                    "format": "jsonv2",
                    "addressdetails": 1,
                    "namedetails": 1,
                    "accept-language": "en",
                    **params,
                },
                headers={"User-Agent": self.config.osm_place_search_user_agent, "Accept": "application/json"},
                timeout=self.config.osm_place_search_timeout_seconds,
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise PlaceSearchError(
                "Place search provider is unavailable", code="place_search_provider_is_unavailable"
            ) from error

    def _result(self, item: object) -> PlaceSearchResult | None:
        if not isinstance(item, dict) or item.get("osm_type") not in {"node", "way", "relation"}:
            return None
        try:
            south, north, west, east = (float(value) for value in item["boundingbox"])
            return PlaceSearchResult(
                osm_element_type=item["osm_type"],
                osm_element_id=str(item["osm_id"]),
                display_name=str(item["display_name"]),
                latitude=float(item["lat"]),
                longitude=float(item["lon"]),
                viewport_north=north,
                viewport_south=south,
                viewport_east=east,
                viewport_west=west,
                **_address(item),
                **_names(item),
            )
        except KeyError, TypeError, ValueError:
            # One malformed provider item must not turn into a partial unsafe
            # record. The owner can refine a search or choose another point.
            return None

    def search(self, query: str) -> list[PlaceSearchResult]:
        payload = self._request("search", {"q": query, "limit": 10})
        if not isinstance(payload, list):
            raise PlaceSearchError(
                "Place search provider returned an invalid response",
                code="place_search_provider_returned_an_invalid_response",
            )
        return [result for item in payload if (result := self._result(item)) is not None]

    def reverse(self, latitude: float, longitude: float) -> PlaceSearchResult | None:
        return self._result(self._request("reverse", {"lat": latitude, "lon": longitude, "zoom": 18}))


class UnavailablePlaceSearchProvider:
    """Lets the route return a safe 503 when a configured provider is absent."""

    name = "unavailable"
    attribution = ""
    attribution_url = ""

    def search(self, query: str) -> list[PlaceSearchResult]:
        raise PlaceSearchError(
            "Configured place search provider is unavailable", code="configured_place_search_provider_is_unavailable"
        )

    def reverse(self, latitude: float, longitude: float) -> PlaceSearchResult | None:
        raise PlaceSearchError(
            "Configured place search provider is unavailable", code="configured_place_search_provider_is_unavailable"
        )


@dataclass
class _CacheEntry:
    expires_at: float
    response: PlaceSearchResponse


class CachedPlaceSearchService:
    def __init__(self, provider: PlaceSearchProvider, config: Settings = settings) -> None:
        self.provider = provider
        self.config = config
        self._lock = Lock()
        self._cache_lock = Lock()
        self._next_request_at = 0.0
        self.cache: OrderedDict[str, _CacheEntry] = OrderedDict()

    def search(self, query: str) -> PlaceSearchResponse:
        normalized = " ".join(query.split())
        return self._lookup(f"search:{normalized}", lambda: self.provider.search(normalized))

    def reverse(self, latitude: float, longitude: float) -> PlaceSearchResponse:
        key = f"reverse:{latitude:.7f},{longitude:.7f}"
        return self._lookup(
            key,
            lambda: [result] if (result := self.provider.reverse(latitude, longitude)) is not None else [],
        )

    def _lookup(self, key: str, lookup) -> PlaceSearchResponse:
        with self._cache_lock:
            cached = self.cache.get(key)
            if cached is not None and cached.expires_at > monotonic():
                self.cache.move_to_end(key)
                return cached.response
        if not self._lock.acquire(blocking=False):
            raise PlaceSearchBusy()
        try:
            now = monotonic()
            if now < self._next_request_at:
                raise PlaceSearchBusy(max(1, ceil(self._next_request_at - now)))
            self._next_request_at = now + 1.0
            results = lookup()
            response = PlaceSearchResponse(
                provider=self.provider.name,
                attribution=self.provider.attribution,
                attribution_url=self.provider.attribution_url,
                results=results,
            )
            with self._cache_lock:
                self.cache[key] = _CacheEntry(monotonic() + self.config.osm_place_search_cache_ttl_seconds, response)
                self.cache.move_to_end(key)
                while len(self.cache) > self.config.osm_place_search_cache_max_entries:
                    self.cache.popitem(last=False)
            return response
        finally:
            self._lock.release()


PLACE_SEARCH_PROVIDERS = {"nominatim": NominatimSearchProvider}


@lru_cache
def _cached_place_search_service() -> CachedPlaceSearchService:
    provider_factory = PLACE_SEARCH_PROVIDERS.get(settings.osm_place_search_provider)
    if provider_factory is None:
        return CachedPlaceSearchService(UnavailablePlaceSearchProvider())
    # Application code may replace this dependency with a self-hosted or
    # contracted provider by registering a factory under its configured name;
    # the API itself is intentionally independent of Nominatim.
    return CachedPlaceSearchService(provider_factory())


_service_lock = Lock()


def get_place_search_service() -> CachedPlaceSearchService:
    # lru_cache alone may run its factory twice on concurrent first requests.
    with _service_lock:
        return _cached_place_search_service()
