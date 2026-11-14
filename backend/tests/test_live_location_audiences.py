"""Live-location audiences are rows: one per session and audience, gone with the audience they were for."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from test_live_location import payload, start
from test_packing import TestingSessionLocal, client_for, setup_function, teardown_function  # noqa: F401

from app.main import app
from app.models import (
    LiveAudienceKind,
    LivePrecision,
    LiveSession,
    LiveSessionAudience,
    ShareLink,
)
from app.services import live_location as live


def settings(session_id: str) -> dict[str, tuple[str, int]]:
    """The stored audiences of a session by key: precision and delay."""
    with TestingSessionLocal() as session:
        return {
            live.AudienceRef.of(row).key: (row.precision.value, row.delay_seconds)
            for row in session.scalars(select(LiveSessionAudience).where(LiveSessionAudience.session_id == session_id))
        }


def error_code(response) -> str:
    return response.json()["errors"][0]["code"]


def with_links(client, trip: str, path: str, count: int = 2, *, activate: bool = True):
    base = f"/api/trips/{trip}"
    links = [client.post(base + "/share-links", json={"label": f"Link {n}"}).json() for n in range(count)]
    if activate:
        for link in links:
            assert client.post(base + f"/share-links/{link['id']}/activate", json={}).status_code == 200
    audiences = {"public": "1km", **{link["id"]: "exact" for link in links}}
    delays = {"public": 900, **{link["id"]: 1800 for link in links}}
    assert client.put(path, json={"enabled": True, "audiences": audiences, "delays": delays}).status_code == 200
    return base, links


def test_each_audience_is_a_row_with_its_own_precision_and_delay() -> None:
    client, trip, root, sid, path = start()
    base, links = with_links(client, trip, path)
    stored = settings(sid)
    assert stored == {"public": ("1km", 900), links[0]["id"]: ("exact", 1800), links[1]["id"]: ("exact", 1800)}
    with TestingSessionLocal() as session:
        kinds = {row.kind for row in session.scalars(select(LiveSessionAudience))}
        assert kinds == {LiveAudienceKind.PUBLIC, LiveAudienceKind.LINK}
    shown = client.get(root).json()[0]
    assert shown["audiences"] == {key: value[0] for key, value in stored.items()}
    assert shown["delays"] == {key: value[1] for key, value in stored.items()}

    # An audience left out goes with its delay; one added later starts at zero, and the others keep theirs.
    kept = {"public": "10km", links[1]["id"]: "1km"}
    assert client.put(path, json={"enabled": True, "audiences": kept}).status_code == 200
    assert settings(sid) == {"public": ("10km", 900), links[1]["id"]: ("1km", 1800)}
    again = {**kept, links[0]["id"]: "exact"}
    assert client.put(path, json={"enabled": True, "audiences": again}).json()["delays"][links[0]["id"]] == 0


def test_a_draft_link_can_be_prepared_but_not_a_foreign_or_unknown_one() -> None:
    client, trip, root, sid, path = start()
    base, links = with_links(client, trip, path, 1, activate=False)
    assert links[0]["id"] in settings(sid)
    other = client.post("/api/trips", json={"title": "Other"}).json()["id"]
    foreign = client.post(f"/api/trips/{other}/share-links", json={"label": "Elsewhere"}).json()["id"]
    for audience in (foreign, "unknown"):
        response = client.put(path, json={"enabled": True, "audiences": {audience: "exact"}})
        assert response.status_code == 422
        assert error_code(response) == "live_audience_unavailable"
    response = client.put(path, json={"enabled": True, "audiences": {"public": "exact"}, "delays": {"x": 900}})
    assert response.status_code == 422 and error_code(response) == "live_delay_audience"


def test_revoking_rotating_or_expiring_a_link_and_unpublishing_leave_no_setting_behind() -> None:
    client, trip, root, sid, path = start()
    base, links = with_links(client, trip, path, 3)
    client.post(base + "/public-projection/publish")
    revoked, rotated, expired = (link["id"] for link in links)

    assert client.post(base + f"/share-links/{revoked}/revoke").status_code == 200
    assert revoked not in settings(sid) and rotated in settings(sid)

    new = client.post(base + f"/share-links/{rotated}/rotate", json={}).json()
    assert rotated not in settings(sid) and new["id"] not in settings(sid)

    with TestingSessionLocal() as session:
        link = session.get(ShareLink, expired)
        assert link is not None
        link.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()
        token = link.token
    assert client.get(f"/api/shared/{token}").status_code == 404
    assert expired not in settings(sid)

    assert "public" in settings(sid)
    assert client.post(base + "/public-projection/unpublish").status_code == 200
    assert settings(sid) == {}
    # The session itself is untouched.
    assert client.get(root).json()[0]["enabled"]


def test_deleting_a_link_session_or_trip_cascades_to_its_rows() -> None:
    client, trip, root, sid, path = start()
    base, links = with_links(client, trip, path)
    with TestingSessionLocal() as session:
        session.delete(session.get(ShareLink, links[0]["id"]))
        session.commit()
    assert links[0]["id"] not in settings(sid) and links[1]["id"] in settings(sid)
    assert client.delete(path).status_code == 204
    assert settings(sid) == {}

    trip2 = client.post("/api/trips", json={"title": "Second"}).json()["id"]
    path2 = f"/api/trips/{trip2}/live-location"
    sid2 = client.post(path2, json={"source": "phone"}).json()["id"]
    audiences = {"enabled": True, "audiences": {"public": "exact"}}
    assert client.put(f"{path2}/{sid2}", json=audiences).status_code == 200
    assert settings(sid2)
    assert client.delete(f"/api/trips/{trip2}").status_code == 204
    assert settings(sid2) == {}


def test_the_rows_refuse_what_the_api_never_writes() -> None:
    client, trip, root, sid, path = start()
    base, links = with_links(client, trip, path, 1)
    link_id = links[0]["id"]
    with TestingSessionLocal() as session:
        for broken in (
            LiveSessionAudience(session_id=sid, kind=LiveAudienceKind.PUBLIC, precision=LivePrecision.EXACT),
            LiveSessionAudience(
                session_id=sid, kind=LiveAudienceKind.LINK, share_link_id=link_id, precision=LivePrecision.EXACT
            ),
            LiveSessionAudience(session_id=sid, kind=LiveAudienceKind.LINK, precision=LivePrecision.EXACT),
            LiveSessionAudience(
                session_id=sid, kind=LiveAudienceKind.PUBLIC, share_link_id=link_id, precision=LivePrecision.EXACT
            ),
            LiveSessionAudience(
                session_id=sid, kind=LiveAudienceKind.LINK, share_link_id="missing", precision=LivePrecision.EXACT
            ),
        ):
            session.add(broken)
            with pytest.raises(IntegrityError):
                session.flush()
            session.rollback()
        row = session.scalars(select(LiveSessionAudience)).first()
        assert row is not None
        row.delay_seconds = 42
        with pytest.raises(IntegrityError):
            session.flush()


def test_the_current_point_is_a_foreign_key_and_the_session_has_timestamps(monkeypatch) -> None:
    clock = datetime.now(UTC)
    monkeypatch.setattr(live, "now", lambda: clock)
    client, trip, root, sid, path = start()
    shown = client.get(root).json()[0]
    assert shown["created_at"] and shown["updated_at"]
    assert client.post(path + "/positions", json=payload(clock)).status_code == 200
    assert client.get(root).json()[0]["current"]
    assert client.delete(path + "/tracks").status_code == 204
    assert client.get(root).json()[0]["current"] is None
    # The database enforces it (the PostgreSQL migration test deletes a point and checks the session is cleared); the
    # SQLite test schema can lose this circular constraint once a PostgreSQL test has created the tables.
    (foreign_key,) = LiveSession.__table__.c.current_id.foreign_keys
    assert foreign_key.column.table.name == "live_points" and foreign_key.ondelete == "SET NULL"
    assert foreign_key.name == "fk_live_sessions_current_point"


@pytest.mark.parametrize("source", ["person.synthetic", "device_tracker.x_1", "my-phone", "Phone:A_1", "a" * 128, "7"])
def test_a_source_is_any_short_plain_identifier(source: str) -> None:
    client, trip, root, sid, path = start()
    created = client.post(root, json={"source": source})
    assert created.status_code == 201 and created.json()["source"] == source


@pytest.mark.parametrize(
    "source", ["", "a" * 129, " phone", "my phone", ".hidden", "-x", "tracker/1", "café", "a\x00b", "a\n", 7, None]
)
def test_a_source_that_is_not_an_identifier_is_refused(source) -> None:
    client, trip, root, sid, path = start()
    assert client.post(root, json={"source": source}).status_code == 422


def test_errors_carry_specific_codes() -> None:
    client, trip, root, sid, path = start()
    assert error_code(client.get(root + "/00000000000000000000000000000000/tracks")) == "not_found"
    assert error_code(client.post(path + "/positions", content=b" " * 4097)) == "live_position_too_large"
    assert error_code(client.post(path + "/positions", json={"latitude": 91})) == "live_invalid_position"
    assert client.put(path, json={"enabled": False}).status_code == 200
    assert error_code(client.post(path + "/positions", json=payload(datetime.now(UTC)))) == "live_disabled"
    for _ in range(19):
        client.post(root, json={"source": "x"})
    assert error_code(client.post(root, json={"source": "x"})) == "live_session_limit"


def test_every_live_location_operation_is_typed_in_the_api_description() -> None:
    schema = app.openapi()
    operations = [
        (path, method, operation)
        for path, methods in schema["paths"].items()
        if "/live-location" in path
        for method, operation in methods.items()
    ]
    assert len(operations) == 8
    for path, method, operation in operations:
        success = next(response for status, response in operation["responses"].items() if status.startswith("2"))
        content = success.get("content", {})
        if method == "delete":
            assert not content, (path, method)
        elif path.endswith("/export"):
            assert list(content) == ["application/x-ndjson"]
        else:
            ref = content["application/json"]["schema"]
            assert "$ref" in ref or "$ref" in ref.get("items", {}), (path, method)
    names = schema["components"]["schemas"]
    assert {"LiveSessionCreate", "LiveSessionConfigure", "LiveSessionResponse"} <= names.keys()
    # The position is read from the raw, size-capped body, so its schema is declared on the operation.
    body = schema["paths"]["/api/trips/{trip_id}/live-location/{session_id}/positions"]["post"]["requestBody"]
    assert body["required"] and set(body["content"]["application/json"]["schema"]["properties"]) == {
        "observed_at",
        "latitude",
        "longitude",
    }
    assert "created_at" in names["LiveSessionResponse"]["required"]
