"""Trip-specific link-preview metadata for the public visitor shell (#245).

Chat apps build a preview from the HTML they are served and never run JavaScript.
This module rewrites the data-free ``public.html`` shell so a *published* trip's
link carries the title, one-line summary and cover the public audience already
receives. It reads only the rendered public projection, so it can never disclose
more than ``GET /api/public/trips/{slug}`` does, and every other case (unknown,
malformed, unpublished or revoked slug) returns the shell unchanged.
"""

import html
import re
from dataclasses import dataclass

TITLE_LIMIT = 70
DESCRIPTION_LIMIT = 200
BRAND = "Travel"
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f  ]+")
_HEAD_END = re.compile(r"</head\s*>", re.IGNORECASE)
_TITLE = re.compile(r"<title\b[^>]*>.*?</title\s*>", re.IGNORECASE | re.DOTALL)
# A cover replaces the shell's whole generic image group at once.
_IMAGE_KEYS = (
    "og:image",
    "og:image:type",
    "og:image:width",
    "og:image:height",
    "og:image:alt",
    "twitter:image",
    "twitter:image:alt",
)


@dataclass(frozen=True)
class Preview:
    """What one published trip's link may show; ``None`` keeps the shell's generic value."""

    title: str | None = None
    description: str | None = None
    url: str | None = None
    image_url: str | None = None
    image_alt: str | None = None
    image_width: int | None = None
    image_height: int | None = None


def clean(value: str | None, limit: int) -> str | None:
    """One line of text without control characters, cut to ``limit`` characters."""
    if not value:
        return None
    text = " ".join(_CONTROL.sub(" ", value).split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _tag(key: str) -> re.Pattern[str]:
    return re.compile(rf'<meta\b[^>]*\b(?:name|property)\s*=\s*["\']{re.escape(key)}["\'][^>]*>\s*', re.IGNORECASE)


def _meta(key: str, content: str) -> str:
    attribute = "name" if key == "description" or key.startswith("twitter:") else "property"
    return f'<meta {attribute}="{key}" content="{html.escape(content, quote=True)}" />\n    '


def _set(document: str, key: str, content: str) -> str:
    """Replace the shell's tag for ``key`` (or add one) with ``content``, escaped."""
    document = _tag(key).sub("", document)
    return _HEAD_END.sub(lambda match: _meta(key, content) + match.group(0), document, count=1)


def _drop(document: str, key: str) -> str:
    return _tag(key).sub("", document)


def render_shell(shell: str, preview: Preview) -> str:
    """The shell with ``preview`` applied. Every value is escaped for an attribute or text."""
    document = shell
    if preview.title:
        label = f"{preview.title} · {BRAND}"
        document = _TITLE.sub(lambda _match: f"<title>{html.escape(label, quote=False)}</title>", document, count=1)
        for key in ("og:title", "twitter:title"):
            document = _set(document, key, label)
    if preview.description:
        for key in ("description", "og:description", "twitter:description"):
            document = _set(document, key, preview.description)
    if preview.url:
        document = _set(document, "og:url", preview.url)
    if preview.image_url:
        for key in _IMAGE_KEYS:
            document = _drop(document, key)
        document = _set(document, "og:image", preview.image_url)
        document = _set(document, "twitter:image", preview.image_url)
        if preview.image_width and preview.image_height:
            document = _set(document, "og:image:width", str(preview.image_width))
            document = _set(document, "og:image:height", str(preview.image_height))
        alt = preview.image_alt or preview.title or BRAND
        document = _set(document, "og:image:alt", alt)
        document = _set(document, "twitter:image:alt", alt)
    return document
