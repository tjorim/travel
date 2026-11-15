from collections.abc import Generator
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.auth import current_subject
from app.database import Base, get_session
from app.main import app
from app.models import DocumentAsset, StoredObject
from app.storage import LocalObjectStorage, get_storage

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def override_session() -> Generator[Session]:
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def client_for(subject: str, tmp_path: Path) -> TestClient:
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[current_subject] = lambda: subject
    app.dependency_overrides[get_storage] = lambda: LocalObjectStorage(root=str(tmp_path))
    return TestClient(app)


def setup_function() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def teardown_function() -> None:
    app.dependency_overrides.clear()


def create_trip(client: TestClient) -> dict:
    response = client.post("/api/trips", json={"title": "Exampleland 2054", "summary": "Private."})
    assert response.status_code == 201, response.text
    return response.json()


def upload_document(
    client: TestClient,
    trip_id: str | None = None,
    contents: bytes = b"private booking details",
    title: str = "Airport hotel booking",
) -> dict:
    data = {"title": title, "document_kind": "booking"}
    if trip_id is not None:
        data["trip_id"] = trip_id
    response = client.post(
        "/api/documents/uploads", data=data, files={"file": ("confirmation.txt", contents, "text/plain")}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_document_upload_list_and_delete_are_owner_only(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])

    assert document["original_filename"] == "confirmation.txt"
    assert document["trip_id"] == trip["id"]
    assert document["file_url"] == f"/api/documents/{document['id']}/original"
    assert "object_key" not in document and "deleted_at" not in document
    assert owner.get(document["file_url"]).content == b"private booking details"
    assert len(owner.get("/api/documents").json()) == 1
    assert len(owner.get(f"/api/documents?trip_id={trip['id']}").json()) == 1

    other = client_for("owner-2", tmp_path)
    assert other.get("/api/documents").json() == []
    assert other.get(f"/api/documents?trip_id={trip['id']}").status_code == 404
    assert other.get(f"/api/documents/{document['id']}").status_code == 404
    assert other.get(document["file_url"]).status_code == 404
    assert other.delete(f"/api/documents/{document['id']}").status_code == 404
    assert other.patch(f"/api/documents/{document['id']}", json={"title": "Hijacked"}).status_code == 404

    owner = client_for("owner-1", tmp_path)
    assert owner.delete(f"/api/documents/{document['id']}").status_code == 204
    assert owner.get("/api/documents").json() == []
    assert owner.get(f"/api/documents/{document['id']}").status_code == 404
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []
    with TestingSessionLocal() as session:
        assert session.query(StoredObject).count() == 0


def test_a_document_is_filed_listed_by_trip_and_unfiled_without_touching_its_file(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    unfiled = upload_document(owner)
    filed = upload_document(owner, trip["id"], contents=b"another file", title="Filed")
    assert unfiled["trip_id"] is None

    assert {item["id"] for item in owner.get("/api/documents").json()} == {unfiled["id"], filed["id"]}
    assert [item["id"] for item in owner.get(f"/api/documents?trip_id={trip['id']}").json()] == [filed["id"]]
    assert [item["id"] for item in owner.get("/api/documents?unfiled=true").json()] == [unfiled["id"]]
    assert owner.get(f"/api/documents?trip_id={trip['id']}&unfiled=true").status_code == 422

    renamed = owner.patch(f"/api/documents/{unfiled['id']}", json={"title": "Passport copy", "trip_id": trip["id"]})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Passport copy"
    assert renamed.json()["trip_id"] == trip["id"]
    assert owner.get(renamed.json()["file_url"]).content == b"private booking details"
    again = owner.patch(f"/api/documents/{unfiled['id']}", json={"trip_id": None})
    assert again.json()["trip_id"] is None
    assert again.json()["title"] == "Passport copy"
    assert owner.patch(f"/api/documents/{unfiled['id']}", json={"title": None}).status_code == 422


def test_a_document_cannot_be_filed_under_another_owners_trip(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    other = client_for("owner-2", tmp_path)
    other_trip = create_trip(other)

    owner = client_for("owner-1", tmp_path)
    upload = owner.post(
        "/api/documents/uploads",
        data={"title": "Insurance policy", "document_kind": "other", "trip_id": other_trip["id"]},
        files={"file": ("policy.txt", b"policy contents", "text/plain")},
    )
    assert upload.status_code == 404
    document = upload_document(owner)
    assert owner.patch(f"/api/documents/{document['id']}", json={"trip_id": other_trip["id"]}).status_code == 404
    assert owner.get(f"/api/documents?trip_id={other_trip['id']}").status_code == 404


def test_the_same_file_is_one_document_per_trip_and_one_stored_file(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    first, second = create_trip(owner), create_trip(owner)
    data = {"title": "Policy", "document_kind": "other"}
    files = {"file": ("policy.txt", b"the same bytes", "text/plain")}

    created = owner.post("/api/documents/uploads", data=data | {"trip_id": first["id"]}, files=files)
    retried = owner.post("/api/documents/uploads", data=data | {"trip_id": first["id"]}, files=files)
    elsewhere = owner.post("/api/documents/uploads", data=data | {"trip_id": second["id"]}, files=files)
    unfiled = owner.post("/api/documents/uploads", data=data, files=files)
    statuses = [created.status_code, retried.status_code, elsewhere.status_code, unfiled.status_code]
    assert statuses == [201, 200, 201, 201]
    assert retried.json()["id"] == created.json()["id"]
    assert len({created.json()["id"], elsewhere.json()["id"], unfiled.json()["id"]}) == 3
    with TestingSessionLocal() as session:
        assert session.query(StoredObject).count() == 1
        assert session.query(DocumentAsset).count() == 3

    # Moving one onto a trip that already holds the file is refused, and the file goes with the last document.
    clash = owner.patch(f"/api/documents/{unfiled.json()['id']}", json={"trip_id": first["id"]})
    assert clash.status_code == 422
    assert clash.json()["errors"][0]["code"] == "that_trip_already_holds_this_file"
    for document in (created, elsewhere):
        assert owner.delete(f"/api/documents/{document.json()['id']}").status_code == 204
    assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 1
    assert owner.delete(f"/api/documents/{unfiled.json()['id']}").status_code == 204
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


def test_deleting_a_trip_unfiles_its_documents_and_keeps_their_files(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    document = upload_document(owner, trip["id"])

    assert owner.delete(f"/api/trips/{trip['id']}").status_code == 204
    kept = owner.get(f"/api/documents/{document['id']}")
    assert kept.status_code == 200
    assert kept.json()["trip_id"] is None
    assert owner.get(kept.json()["file_url"]).content == b"private booking details"
    assert owner.get("/api/documents?unfiled=true").json()[0]["id"] == document["id"]


def test_a_document_attached_to_a_stay_stays_with_its_trip(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    other_trip = create_trip(owner)
    document = upload_document(owner, trip["id"])
    unfiled = upload_document(owner, contents=b"unfiled file")
    area = owner.post(f"/api/trips/{trip['id']}/areas", json={"label": "Taipei", "country_code": "TW"}).json()
    other_area = owner.post(f"/api/trips/{other_trip['id']}/areas", json={"label": "Taipei"}).json()
    stay = {"area_id": area["id"], "check_in_date": "2054-04-01", "check_out_date": "2054-04-05"}
    stays = f"/api/trips/{trip['id']}/stays"

    # Only a document filed under this trip can be attached to its records.
    assert owner.post(stays, json=stay | {"document_asset_ids": [unfiled["id"]]}).status_code == 422
    elsewhere = stay | {"area_id": other_area["id"], "document_asset_ids": [document["id"]]}
    assert owner.post(f"/api/trips/{other_trip['id']}/stays", json=elsewhere).status_code == 422
    created = owner.post(stays, json=stay | {"document_asset_ids": [document["id"]]})
    assert created.status_code == 201, created.text
    assert created.json()["document_asset_ids"] == [document["id"]]

    moved = owner.patch(f"/api/documents/{document['id']}", json={"trip_id": other_trip["id"]})
    assert moved.status_code == 422
    assert moved.json()["errors"][0]["code"] == "detach_the_document_from_stays_and_routes_before_moving_it"
    assert owner.patch(f"/api/documents/{document['id']}", json={"title": "Renamed"}).status_code == 200

    assert owner.patch(f"{stays}/{created.json()['id']}", json={"document_asset_ids": []}).status_code == 200
    assert owner.patch(f"/api/documents/{document['id']}", json={"trip_id": other_trip["id"]}).status_code == 200


def test_the_trip_and_library_routes_are_aliases_of_the_same_documents(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip = create_trip(owner)
    other_trip = create_trip(owner)
    document = owner.post(
        f"/api/trips/{trip['id']}/documents/uploads",
        data={"title": "Ticket", "document_kind": "booking"},
        files={"file": ("ticket.txt", b"ticket", "text/plain")},
    )
    assert document.status_code == 201
    identifier = document.json()["id"]
    library = owner.post(
        "/api/library/documents/uploads",
        data={"title": "Policy", "document_kind": "other", "linked_trip_id": other_trip["id"]},
        files={"file": ("policy.txt", b"policy", "text/plain")},
    )
    assert library.status_code == 201
    assert library.json()["trip_id"] == other_trip["id"]

    assert [item["id"] for item in owner.get(f"/api/trips/{trip['id']}/documents").json()] == [identifier]
    assert (
        owner.get(f"/api/trips/{trip['id']}/documents/{identifier}").json()
        == owner.get(f"/api/library/documents/{identifier}").json()
        == owner.get(f"/api/documents/{identifier}").json()
    )
    assert owner.get(f"/api/trips/{trip['id']}/documents/{identifier}/original").content == b"ticket"
    assert owner.get(f"/api/library/documents/{identifier}/original").content == b"ticket"
    # A trip route names a document only under its own trip.
    assert owner.get(f"/api/trips/{other_trip['id']}/documents/{identifier}").status_code == 404
    assert owner.delete(f"/api/trips/{other_trip['id']}/documents/{identifier}").status_code == 404
    assert {item["id"] for item in owner.get("/api/library/documents").json()} == {identifier, library.json()["id"]}
    linked = owner.get(f"/api/library/documents?linked_trip_id={other_trip['id']}").json()
    assert [item["id"] for item in linked] == [library.json()["id"]]
    patched = owner.patch(f"/api/library/documents/{identifier}", json={"title": "Renamed"})
    assert patched.json()["title"] == "Renamed"
    assert owner.delete(f"/api/library/documents/{library.json()['id']}").status_code == 204
    assert owner.delete(f"/api/trips/{trip['id']}/documents/{identifier}").status_code == 204
    assert owner.get("/api/documents").json() == []


def test_oversized_or_empty_document_uploads_are_refused_with_a_readable_reason(tmp_path: Path, monkeypatch) -> None:
    from app.config import settings

    monkeypatch.setattr(settings, "media_max_upload_bytes", 10)
    owner = client_for("owner-1", tmp_path)
    url = "/api/documents/uploads"
    data = {"title": "Too big", "document_kind": "other"}

    big = owner.post(url, data=data, files={"file": ("big.txt", b"x" * 11, "text/plain")})
    assert big.status_code == 422
    assert "groter dan de toegestane" in big.json()["detail"]
    empty = owner.post(url, data=data, files={"file": ("empty.txt", b"", "text/plain")})
    assert empty.status_code == 422
    assert empty.json()["detail"] == "Het bestand is leeg."
    assert owner.get("/api/documents").json() == []


def test_originals_are_never_sniffed_and_unsafe_types_download_instead_of_rendering(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    url = "/api/documents/uploads"
    html = owner.post(
        url,
        data={"title": "Page", "document_kind": "other"},
        files={"file": ("page.html", b"<script>alert(1)</script>", "text/html")},
    ).json()
    pdf = owner.post(
        url,
        data={"title": "Ticket", "document_kind": "booking"},
        files={"file": ("ticket.pdf", b"%PDF-1.4", "application/pdf")},
    ).json()
    svg = owner.post(
        url,
        data={"title": "Logo", "document_kind": "other"},
        files={"file": ("logo.svg", b"<svg onload='alert(1)'/>", "image/svg+xml")},
    ).json()

    for unsafe in (owner.get(html["file_url"]), owner.get(svg["file_url"])):
        assert unsafe.headers["x-content-type-options"] == "nosniff"
        assert unsafe.headers["content-disposition"] == "attachment"
        assert unsafe.headers["cache-control"] == "no-store"
    safe = owner.get(pdf["file_url"])
    assert safe.headers["x-content-type-options"] == "nosniff"
    assert "content-disposition" not in safe.headers


def test_deleting_trips_that_share_a_file_with_each_other_or_an_unfiled_document_keeps_every_document(
    tmp_path: Path,
) -> None:
    owner = client_for("owner-1", tmp_path)
    first, second = create_trip(owner), create_trip(owner)
    data = {"title": "Policy", "document_kind": "other"}
    files = {"file": ("policy.txt", b"the same bytes", "text/plain")}
    unfiled = owner.post("/api/documents/uploads", data=data, files=files).json()
    filed = [
        owner.post("/api/documents/uploads", data=data | {"trip_id": trip["id"]}, files=files).json()
        for trip in (first, second)
    ]

    # An unfiled document already holds the file, and then so does each trip being deleted.
    assert owner.delete(f"/api/trips/{first['id']}").status_code == 204
    assert owner.delete(f"/api/trips/{second['id']}").status_code == 204

    documents = owner.get("/api/documents").json()
    assert {document["id"] for document in documents} == {unfiled["id"], filed[0]["id"], filed[1]["id"]}
    assert {document["trip_id"] for document in documents} == {None}
    with TestingSessionLocal() as session:
        assert session.query(StoredObject).count() == 1
    assert len([path for path in tmp_path.rglob("*") if path.is_file()]) == 1
    # Uploading the file again is a retry of an unfiled document that holds it, not a fourth.
    again = owner.post("/api/documents/uploads", data=data, files=files)
    assert (again.status_code, again.json()["id"] in {document["id"] for document in documents}) == (200, True)
    assert len(owner.get("/api/documents").json()) == 3
    # The file stays until the last document goes.
    for document in documents:
        assert owner.delete(f"/api/documents/{document['id']}").status_code == 204
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


def test_the_library_patch_alias_still_reads_linked_trip_id(tmp_path: Path) -> None:
    owner = client_for("owner-1", tmp_path)
    trip, other_trip = create_trip(owner), create_trip(owner)
    document = upload_document(owner, trip["id"])
    path = f"/api/library/documents/{document['id']}"

    moved = owner.patch(path, json={"linked_trip_id": other_trip["id"]})
    assert (moved.status_code, moved.json()["trip_id"]) == (200, other_trip["id"])
    renamed = owner.patch(path, json={"title": "Renamed"})  # omitted: the filing is unchanged
    assert (renamed.json()["title"], renamed.json()["trip_id"]) == ("Renamed", other_trip["id"])
    unfiled = owner.patch(path, json={"linked_trip_id": None})  # explicit null: unfiled
    assert unfiled.json()["trip_id"] is None
    # The new name works there too; two different trips in one body are refused, and the title cannot be null.
    assert owner.patch(path, json={"trip_id": trip["id"]}).json()["trip_id"] == trip["id"]
    both = owner.patch(path, json={"trip_id": trip["id"], "linked_trip_id": other_trip["id"]})
    assert both.status_code == 422
    assert owner.patch(path, json={"title": None}).status_code == 422
    assert owner.get(path).json()["trip_id"] == trip["id"]
