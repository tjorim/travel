"""Owner provider-token storage, kept out of the application database.

A Google Photos or GoPro Cloud access token authorizes reading the owner's
own library; it is provenance for an import, never a canonical field, and
never appears in an API response. `InMemorySecretStore` is a process-local
placeholder — production should back this with a real secret manager — but
every caller in this module already goes through the same narrow interface,
so swapping the backend later touches no request handler.
"""

from typing import Protocol


class SecretStore(Protocol):
    def set_token(self, *, subject: str, provider: str, token: str) -> None: ...

    def get_token(self, *, subject: str, provider: str) -> str | None: ...

    def revoke_token(self, *, subject: str, provider: str) -> None: ...


class InMemorySecretStore:
    def __init__(self) -> None:
        self._tokens: dict[tuple[str, str], str] = {}

    def set_token(self, *, subject: str, provider: str, token: str) -> None:
        self._tokens[(subject, provider)] = token

    def get_token(self, *, subject: str, provider: str) -> str | None:
        return self._tokens.get((subject, provider))

    def revoke_token(self, *, subject: str, provider: str) -> None:
        self._tokens.pop((subject, provider), None)


_default_secret_store = InMemorySecretStore()


def get_secret_store() -> SecretStore:
    return _default_secret_store
