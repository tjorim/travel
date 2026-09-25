"""Unlisted share-link capability tokens.

A capability is 256 bits of CSPRNG entropy encoded URL-safe. Its separate
keyed HMAC-SHA256 verifier is what anonymous delivery queries use; the URL
itself is available only through owner-authenticated link management.
"""

import hashlib
import hmac
import secrets

from .config import settings


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def verifier_for(token: str) -> str:
    return hmac.new(settings.share_link_secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()
