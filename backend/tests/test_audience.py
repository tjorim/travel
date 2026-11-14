"""One audience interface over the public view, a hidden link and a collection member (#360, decision 360)."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from test_future_warnings import _public_scope, _route, _trip  # noqa: F401
from test_publication import (  # noqa: F401
    activate,
    add_update,
    client_for,
    create_trip,
    engine,
    item,
    setup_function,
    share,
    teardown_function,
)

from app.audience import (
    AudienceKind,
    LinkAudience,
    MemberAudience,
    PublicAudience,
    Reach,
    audiences_of_trip,
)
from app.models import AuditEventKind, AuditTargetType, CollectionAuditKind, PublicSurface
from app.precision import audience_precision
from app.schemas import ShareScopeInput
from app.services import audiences
from app.services.publication import public_preview


def _audiences(owner: TestClient) -> dict:
    """A trip with a timed route before it starts, and all three audiences listing that route."""
    trip = _trip(owner)
    route = _route(owner, trip["id"], "2054-04-02", carrier="EVA Air")
    share(owner, trip["id"], "route", route["id"], "custom")
    scope = {"items": [item("route", route["id"])], "defaults": None}
    _public_scope(owner, trip["id"], items=scope["items"])
    link = owner.post(f"/api/trips/{trip['id']}/share-links", json={"label": "Family", "scope": scope}).json()
    collection = owner.post("/api/collections", json={"label": "Friends"}).json()
    members = owner.post(
        f"/api/collections/{collection['id']}/members", json={"trip_id": trip["id"], "scope": scope}
    ).json()["members"]
    return {"trip": trip, "link": link, "collection": collection, "member": members[0]}


def test_each_kind_answers_the_same_questions() -> None:
    owner = client_for("owner-1")
    found = _audiences(owner)
    trip_id, link_id, member_id = found["trip"]["id"], found["link"]["id"], found["member"]["id"]
    with Session(engine) as session:
        by_id = {audience.id: audience for audience in audiences_of_trip(session, trip_id, Reach.STORED)}
        assert set(by_id) == {"public", f"link:{link_id}", f"collection:{member_id}"}
        public, link, member = by_id["public"], by_id[f"link:{link_id}"], by_id[f"collection:{member_id}"]
        assert [type(a) for a in (public, link, member)] == [PublicAudience, LinkAudience, MemberAudience]
        assert [a.kind for a in (public, link, member)] == list(AudienceKind)
        assert [a.record_id for a in (public, link, member)] == [trip_id, link_id, member_id]
        # Only the public view is the baseline that cannot exclude.
        assert [a.can_exclude for a in (public, link, member)] == [False, True, True]
        assert [a.schema_version for a in (public, link, member)] == [
            "travel/public-trip@1",
            "travel/unlisted-trip@1",
            "travel/unlisted-trip@1",
        ]
        # Live location names the public view or a hidden link, never a collection member (decision 244).
        assert [a.live_location_key for a in (public, link, member)] == ["public", link_id, None]
        assert [a.label for a in (public, link, member)] == [None, "Family", "Friends"]
        assert all(a.editable and not a.live for a in (public, link, member))
        # A member writes its history to its collection's trail, the others to the trip's.
        assert public.audit_target.target_type == AuditTargetType.PUBLIC_SURFACE
        assert public.audit_target.scope_change == AuditEventKind.PUBLIC_PROJECTION_SCOPE_CHANGE
        assert link.audit_target.target_type == AuditTargetType.SHARE_LINK
        assert link.audit_target.target_id == link_id
        assert member.audit_target.scope_change == CollectionAuditKind.MEMBER_SCOPE_CHANGE
        assert member.audit_target.collection_id == found["collection"]["id"]
        assert member.audit_target.target_type is None


def test_the_lists_of_a_trips_audiences_follow_state() -> None:
    owner = client_for("owner-1")
    found = _audiences(owner)
    trip_id, link_id = found["trip"]["id"], found["link"]["id"]

    def ids(reach: Reach) -> set[str]:
        with Session(engine) as session:
            return {audience.id for audience in audiences_of_trip(session, trip_id, reach)}

    everything = ids(Reach.STORED)
    assert len(everything) == 3
    # Drafts deliver once activated; an unpublished public view is stored and open but delivers nothing.
    assert ids(Reach.OPEN) == everything
    assert ids(Reach.DELIVERING) == set()

    owner.post(f"/api/trips/{trip_id}/public-projection/publish")
    assert ids(Reach.DELIVERING) == {"public"}
    activate(owner, trip_id, link_id)
    owner.post(f"/api/collections/{found['collection']['id']}/activate", json={"expires_in_days": 30})
    assert ids(Reach.DELIVERING) == everything

    owner.post(f"/api/trips/{trip_id}/share-links/{link_id}/revoke", json={})
    assert ids(Reach.OPEN) == everything - {f"link:{link_id}"}
    assert ids(Reach.STORED) == everything


def test_a_collection_member_has_the_same_future_disclosure_review_as_a_link() -> None:
    owner = client_for("owner-1")
    found = _audiences(owner)
    trip_id = found["trip"]["id"]
    with Session(engine) as session:
        reviews = {
            audience.id: audiences.review_future(session, "owner-1", audience)
            for audience in audiences_of_trip(session, trip_id, Reach.STORED)
        }
        assert {review.model_dump_json() for review in reviews.values()} == {'{"transport":1,"day_dates":1}'}
        # The candidate is validated and counted like a save, for a member as for a link.
        member = next(a for a in audiences_of_trip(session, trip_id, Reach.STORED) if isinstance(a, MemberAudience))
        empty = audiences.review_future(session, "owner-1", member, ShareScopeInput(items=[], defaults=None))
        assert empty.model_dump() == {"transport": 0, "day_dates": 0}


def test_a_collection_member_future_disclosure_route_answers_like_the_link_one() -> None:
    owner = client_for("owner-1")
    found = _audiences(owner)
    trip_id, link_id, member_id = found["trip"]["id"], found["link"]["id"], found["member"]["id"]
    collection_id = found["collection"]["id"]
    member_path = f"/api/collections/{collection_id}/members/{member_id}/future-disclosure"
    link_path = f"/api/trips/{trip_id}/share-links/{link_id}/future-disclosure"

    saved = owner.post(member_path)
    assert saved.status_code == 200, saved.text
    assert saved.json() == owner.post(link_path).json() == {"transport": 1, "day_dates": 1}
    # The candidate is counted instead of the saved scope, and nothing is stored.
    empty = {"items": [], "defaults": None}
    assert owner.post(member_path, json=empty).json() == {"transport": 0, "day_dates": 0}
    assert owner.post(member_path).json() == {"transport": 1, "day_dates": 1}
    # A date cap in the candidate is applied like a save, and exactly as a link applies it.
    month = {"items": found["member"]["scope"]["items"], "defaults": {"date_precision": "month"}}
    capped = owner.post(member_path, json=month).json()
    assert capped == owner.post(link_path, json=month).json()
    assert capped["day_dates"] == 0
    # An invalid candidate is refused as the save refuses it.
    invalid = {"items": [item("route", "no-such-route")], "defaults": None}
    assert owner.post(member_path, json=invalid).status_code == owner.post(link_path, json=invalid).status_code
    assert owner.post(member_path, json=invalid).status_code in {404, 409, 422}


def test_a_collection_member_future_disclosure_review_is_owner_only_and_scoped_to_its_collection() -> None:
    owner = client_for("owner-1")
    found = _audiences(owner)
    collection_id, member_id = found["collection"]["id"], found["member"]["id"]
    other = owner.post("/api/collections", json={"label": "Other"}).json()
    unknown = owner.post(f"/api/collections/{other['id']}/members/{member_id}/future-disclosure")
    assert unknown.status_code == 404
    path = f"/api/collections/{collection_id}/members/{member_id}/future-disclosure"
    stranger = client_for("stranger-9")
    assert stranger.post(path).status_code == 404
    assert client_for("owner-1").post(path).status_code == 200


def test_a_public_view_that_was_never_saved_previews_with_the_month_cap_it_will_hold() -> None:
    owner = client_for("owner-1")
    trip = create_trip(owner)
    add_update(owner, trip["id"], "Shared story", visibility="everyone")

    # The preview route, and the service the preview file and navigation routes (GET, no candidate) use.
    document = owner.post(f"/api/trips/{trip['id']}/public-projection/preview").json()
    assert document["updates"][0]["date_precision"] == "month"
    with Session(engine) as session:
        _, scope = public_preview(session, "owner-1", trip["id"])
        assert audience_precision(scope) == "month"
        assert session.get(PublicSurface, trip["id"]) is None  # the preview created nothing

    # The first saved view reads the same: the preview agrees with what saving then delivers.
    saved = owner.get(f"/api/trips/{trip['id']}/public-projection").json()
    assert saved["scope"]["defaults"] == {"date_precision": "month"}
    again = owner.post(f"/api/trips/{trip['id']}/public-projection/preview").json()
    assert again["updates"][0]["date_precision"] == "month"
