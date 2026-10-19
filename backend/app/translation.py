"""Owner-requested Dutch/English draft translation through a self-hosted LibreTranslate.

The service is CPU-bound and starts on demand (tjorim/apps#252), so one owner
request is split into paragraph-sized pieces that are sent strictly one after
another, and only one owner request is translated at a time. Nothing is stored:
the translation is returned as a draft for the owner to edit. The text is sent
only to the configured internal service and never written to a log, an error or
a cache that outlives the request.
"""

import asyncio
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from .config import Settings, settings
from .errors import ServiceError

logger = logging.getLogger(__name__)


class TranslationError(ServiceError, RuntimeError):
    """A service failure that deliberately contains none of the submitted text."""


class TranslationCancelled(Exception):
    """The owner stopped waiting, so the remaining pieces are not translated."""


@dataclass(frozen=True)
class Piece:
    """Text to translate; its surrounding whitespace is kept as written."""

    lead: str
    body: str
    trail: str


Line = list[str | Piece]

# Markdown that opens a line and is not prose: quote marks, heading marks, list
# and task markers. It is kept and only the text after it is translated.
_LINE_PREFIX = re.compile(r"^\s*(?:>\s*)*(?:(?:#{1,6}|[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?")
_FENCE = re.compile(r"^\s*(?:```|~~~)")
_TABLE_RULE = re.compile(r"^[\s|:+-]*$")
_ONLY_URL = re.compile(r"^<?(?:https?://|mailto:)\S+>?$")
_SENTENCE_END = re.compile(r"(?<=[.!?\u2026])\s+")


def _piece(text: str) -> str | Piece:
    body = text.strip()
    if not any(character.isalpha() for character in body) or _ONLY_URL.match(body):
        return text
    lead = text[: len(text) - len(text.lstrip())]
    return Piece(lead, body, text[len(text.rstrip()) :])


def _table_row(raw: str) -> Line:
    row: Line = []
    for cell in raw.split("|"):
        row += [_piece(cell), "|"]
    return row[:-1]


def plan(text: str) -> list[Line]:
    """Split Markdown into lines whose prose is translated and whose syntax is kept verbatim.

    Code fences, horizontal rules, table rules and bare links stay as written.
    A table row keeps its pipes and translates each cell."""
    lines: list[Line] = []
    fenced = False
    for raw in text.replace("\r\n", "\n").split("\n"):
        if _FENCE.match(raw):
            fenced = not fenced
            lines.append([raw])
        elif fenced or not raw.strip():
            lines.append([raw])
        elif raw.lstrip().startswith("|"):
            lines.append([raw] if _TABLE_RULE.match(raw) else _table_row(raw))
        else:
            prefix = _LINE_PREFIX.match(raw)
            assert prefix is not None
            lines.append([prefix.group(), _piece(raw[prefix.end() :])])
    return lines


def chunks(body: str, limit: int) -> list[str]:
    """Pack sentences into pieces of at most `limit` characters; a longer sentence stays whole."""
    if len(body) <= limit:
        return [body]
    packed: list[str] = []
    for sentence in _SENTENCE_END.split(body):
        if packed and len(packed[-1]) + 1 + len(sentence) <= limit:
            packed[-1] = f"{packed[-1]} {sentence}"
        else:
            packed.append(sentence)
    return packed


class TranslationService:
    def __init__(self, config: Settings = settings, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.config = config
        self.transport = transport
        # Concurrent requests only queue for the one CPU, so they wait instead.
        self._turn = asyncio.Lock()

    async def translate(
        self, text: str, source: str, target: str, *, cancelled: Callable[[], Awaitable[bool]] | None = None
    ) -> str:
        base = (self.config.translation_api_base or "").rstrip("/")
        if urlsplit(base).scheme not in {"http", "https"}:
            raise TranslationError("Translation is not configured", code="translation_is_not_configured")
        lines = plan(text)
        translated: dict[str, str] = {}
        timeout = self.config.translation_timeout_seconds
        started = time.monotonic()
        try:
            # One total deadline includes waiting for the slot and every piece.
            # Proxy environment variables and redirects must never route drafts
            # or backend credentials to a different destination.
            async with (
                asyncio.timeout(timeout),
                self._turn,
                httpx.AsyncClient(
                    timeout=httpx.Timeout(timeout, connect=self.config.translation_connect_timeout_seconds),
                    transport=self.transport,
                    trust_env=False,
                    follow_redirects=False,
                ) as client,
            ):
                for part in (part for line in lines for part in line):
                    if not isinstance(part, Piece) or part.body in translated:
                        continue
                    results = []
                    for chunk in chunks(part.body, self.config.translation_segment_characters):
                        if cancelled is not None and await cancelled():
                            raise TranslationCancelled
                        results.append(await self._request(client, base, chunk, source, target))
                    translated[part.body] = " ".join(results)
        except TimeoutError:
            logger.warning("translation_failed code=timeout")
            raise TranslationError(
                "Translation service is unavailable", code="translation_service_is_unavailable"
            ) from None
        logger.info("translation_completed duration_ms=%d", int((time.monotonic() - started) * 1000))
        return "\n".join(
            "".join(
                f"{part.lead}{translated[part.body]}{part.trail}" if isinstance(part, Piece) else part for part in line
            )
            for line in lines
        )

    async def _request(self, client: httpx.AsyncClient, base: str, piece: str, source: str, target: str) -> str:
        payload = {"q": piece, "source": source, "target": target, "format": "text"}
        if self.config.translation_api_key_file:
            try:
                key = Path(self.config.translation_api_key_file).read_text().strip()
                if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", key):
                    raise ValueError
            except (OSError, ValueError):
                logger.warning("translation_failed code=credential_unavailable")
                raise TranslationError(
                    "Translation service is unavailable", code="translation_service_is_unavailable"
                ) from None
            payload["api_key"] = key
        try:
            response = await client.post(f"{base}/translate", json=payload)
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPError:
            logger.warning("translation_failed code=service_unavailable")
            # Neither the exception text nor the request may reach a log or a response.
            raise TranslationError(
                "Translation service is unavailable", code="translation_service_is_unavailable"
            ) from None
        except ValueError:
            payload = None
        translated = payload.get("translatedText") if isinstance(payload, dict) else None
        if not isinstance(translated, str) or not translated.strip():
            logger.warning("translation_failed code=invalid_response")
            raise TranslationError(
                "Translation service returned an invalid response",
                code="translation_service_returned_an_invalid_response",
            )
        return translated.strip()


@lru_cache
def get_translation_service() -> TranslationService:
    return TranslationService()
