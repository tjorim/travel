"""Encrypted, owner-scoped provider credentials and single-use OAuth state."""

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Protocol

from cryptography.fernet import Fernet
from sqlalchemy import select

from .config import settings
from .database import SessionLocal
from .models import ProviderSecret


@dataclass
class Credential:
    access_token: str
    refresh_token: str | None = None
    expires_at: str | None = None

    def expired(self) -> bool:
        return self.expires_at is not None and datetime.fromisoformat(self.expires_at) <= datetime.now(UTC)


class SecretStore(Protocol):
    def set_credential(self, *, subject: str, provider: str, credential: Credential) -> None: ...
    def get_credential(self, *, subject: str, provider: str) -> Credential | None: ...
    def revoke_token(self, *, subject: str, provider: str) -> None: ...
    def set_pending(self, *, subject: str, provider: str, state: str, verifier: str) -> None: ...
    def pop_pending(self, *, subject: str, provider: str, state: str) -> str | None: ...

    # Compatibility with the temporary manual-token API and test fakes.
    def set_token(self, *, subject: str, provider: str, token: str) -> None: ...
    def get_token(self, *, subject: str, provider: str) -> str | None: ...


class InMemorySecretStore:
    def __init__(self) -> None:
        self._credentials: dict[tuple[str, str], Credential] = {}
        self._pending: dict[tuple[str, str], tuple[str, str]] = {}

    def set_credential(self, *, subject: str, provider: str, credential: Credential) -> None:
        self._credentials[(subject, provider)] = credential

    def get_credential(self, *, subject: str, provider: str) -> Credential | None:
        return self._credentials.get((subject, provider))

    def set_token(self, *, subject: str, provider: str, token: str) -> None:
        self.set_credential(subject=subject, provider=provider, credential=Credential(token))

    def get_token(self, *, subject: str, provider: str) -> str | None:
        credential = self.get_credential(subject=subject, provider=provider)
        return credential.access_token if credential else None

    def revoke_token(self, *, subject: str, provider: str) -> None:
        self._credentials.pop((subject, provider), None)
        self._pending.pop((subject, provider), None)

    def set_pending(self, *, subject: str, provider: str, state: str, verifier: str) -> None:
        self._pending[(subject, provider)] = (state, verifier)

    def pop_pending(self, *, subject: str, provider: str, state: str) -> str | None:
        pending = self._pending.get((subject, provider))
        if not pending or pending[0] != state:
            return None
        del self._pending[(subject, provider)]
        return pending[1]


class DatabaseSecretStore:
    def __init__(self, key: str, session_factory=SessionLocal) -> None:
        self._fernet = Fernet(key.encode())
        self._session_factory = session_factory

    def _read(self, subject: str, provider: str, kind: str) -> dict | None:
        with self._session_factory() as session:
            row = session.get(ProviderSecret, (subject, provider, kind))
            return json.loads(self._fernet.decrypt(row.ciphertext.encode())) if row else None

    def _write(self, subject: str, provider: str, kind: str, value: dict) -> None:
        encrypted = self._fernet.encrypt(json.dumps(value).encode()).decode()
        with self._session_factory() as session:
            row = session.get(ProviderSecret, (subject, provider, kind))
            if row:
                row.ciphertext = encrypted
            else:
                session.add(ProviderSecret(subject=subject, provider=provider, kind=kind, ciphertext=encrypted))
            session.commit()

    def _delete(self, subject: str, provider: str, kind: str) -> None:
        with self._session_factory() as session:
            row = session.get(ProviderSecret, (subject, provider, kind))
            if row:
                session.delete(row)
                session.commit()

    def set_credential(self, *, subject: str, provider: str, credential: Credential) -> None:
        self._write(subject, provider, "credential", asdict(credential))

    def get_credential(self, *, subject: str, provider: str) -> Credential | None:
        value = self._read(subject, provider, "credential")
        return Credential(**value) if value else None

    def set_token(self, *, subject: str, provider: str, token: str) -> None:
        self.set_credential(subject=subject, provider=provider, credential=Credential(token))

    def get_token(self, *, subject: str, provider: str) -> str | None:
        credential = self.get_credential(subject=subject, provider=provider)
        return credential.access_token if credential else None

    def revoke_token(self, *, subject: str, provider: str) -> None:
        self._delete(subject, provider, "credential")
        self._delete(subject, provider, "pending")

    def set_pending(self, *, subject: str, provider: str, state: str, verifier: str) -> None:
        self._write(subject, provider, "pending", {"state": state, "verifier": verifier, "created": datetime.now(UTC).isoformat()})

    def pop_pending(self, *, subject: str, provider: str, state: str) -> str | None:
        # Lock and consume in one transaction so two callbacks cannot use one code verifier.
        with self._session_factory() as session:
            row = session.scalar(select(ProviderSecret).where(
                ProviderSecret.subject == subject,
                ProviderSecret.provider == provider,
                ProviderSecret.kind == "pending",
            ).with_for_update())
            if row is None:
                return None
            value = json.loads(self._fernet.decrypt(row.ciphertext.encode()))
            if value["state"] != state:
                return None
            session.delete(row)
            session.commit()
            age = (datetime.now(UTC) - datetime.fromisoformat(value["created"])).total_seconds()
            return value["verifier"] if age < 600 else None


def get_secret_store() -> SecretStore:
    if not settings.provider_secret_key:
        # Provider routes remain readable so the PWA can hide an unconfigured provider.
        return InMemorySecretStore()
    return DatabaseSecretStore(settings.provider_secret_key)
