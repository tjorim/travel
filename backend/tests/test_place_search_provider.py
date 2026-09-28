import httpx

from app.places.search import NominatimSearchProvider


def test_nominatim_requests_english_names_for_search_and_reverse(monkeypatch) -> None:
    requests = []
    place = {
        "osm_type": "relation",
        "osm_id": 123,
        "display_name": "Taipei, Exampleland",
        "lat": "25.033",
        "lon": "121.565",
        "boundingbox": ["25.0", "25.1", "121.5", "121.6"],
        "address": {"city": "Taipei", "country_code": "tw"},
    }

    def get(url, *, params, headers, timeout):
        requests.append((url, params, headers))
        payload = [place] if url.endswith("/search") else place
        return httpx.Response(200, json=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", get)
    provider = NominatimSearchProvider()

    assert provider.search("Taipei")[0].display_name == "Taipei, Exampleland"
    assert provider.reverse(25.033, 121.565).locality == "Taipei"
    assert [request[1]["accept-language"] for request in requests] == ["en", "en"]
