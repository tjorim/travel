from datetime import timedelta

from app import maintenance


class FakeSession:
    def __init__(self) -> None:
        self.rolled_back = False
        self.closed = False

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


def test_purge_command_uses_the_configured_recovery_window(monkeypatch, capsys) -> None:
    session = FakeSession()
    captured: dict[str, object] = {}

    monkeypatch.setattr(maintenance, "SessionLocal", lambda: session)
    monkeypatch.setattr(maintenance, "get_storage", lambda: "storage")

    def fake_purge(purge_session, storage, *, older_than):
        captured.update(session=purge_session, storage=storage, older_than=older_than)
        return 3

    monkeypatch.setattr(maintenance, "purge_deleted_media", fake_purge)

    assert maintenance.main(["purge-deleted-media", "--retention-days", "30"]) == 0
    assert captured == {"session": session, "storage": "storage", "older_than": timedelta(days=30)}
    assert session.closed
    assert capsys.readouterr().out == "Travel media purge completed: objects_purged=3\n"


def test_purge_command_rolls_back_and_hides_storage_details_on_failure(monkeypatch, capsys) -> None:
    session = FakeSession()
    monkeypatch.setattr(maintenance, "SessionLocal", lambda: session)
    monkeypatch.setattr(maintenance, "get_storage", lambda: "storage")

    def failing_purge(*_args, **_kwargs):
        raise RuntimeError("private/object-key")

    monkeypatch.setattr(maintenance, "purge_deleted_media", failing_purge)

    assert maintenance.main(["purge-deleted-media", "--retention-days", "30"]) == 1
    assert session.rolled_back
    assert session.closed
    assert capsys.readouterr().err == "Travel maintenance purge failed\n"


def test_audit_purge_command_uses_the_application_policy_default(monkeypatch, capsys) -> None:
    session = FakeSession()
    captured: dict[str, object] = {}
    monkeypatch.setattr(maintenance, "SessionLocal", lambda: session)

    def fake_purge(purge_session):
        captured["session"] = purge_session
        return 4

    monkeypatch.setattr(maintenance, "purge_expired_audit_events", fake_purge)

    assert maintenance.main(["purge-expired-audit-events"]) == 0
    assert captured == {"session": session}
    assert session.closed
    assert capsys.readouterr().out == "Travel audit purge completed: events_purged=4\n"
