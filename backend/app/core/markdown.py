"""Markdown for long-form text fields, rendered once, on the server.

Records store the owner's Markdown source, never HTML. This module is the one
render path for every view: the owner app, the public page and share links all
receive the same sanitized HTML, so no client needs a parser or sanitizer of
its own.

Raw HTML is disabled in the parser and the output is sanitized anyway, with a
small allowlist: paragraphs, emphasis, headings, lists, links, blockquotes,
code, rules and GFM tables. Headings move three levels down (``#`` becomes
``h4``) so notes never outrank the page and section headings around them.
Task-list items (``- [ ]``, ``- [x]``) render as disabled checkboxes: they are
display-only and never create or change trip tasks.

Two fields use a narrower format through the same module. A media caption is
inline Markdown only (bold, italic and links, no blocks), and a stay's contact
details are plain text whose phone numbers, email addresses and web addresses
become links, with its line breaks kept.
"""

import html
import re
from typing import Literal

import nh3
from markdown_it import MarkdownIt
from markdown_it.rules_core import StateCore
from mdit_py_plugins.tasklists import tasklists_plugin

Audience = Literal["owner", "public"]
Format = Literal["markdown", "inline", "contact"]

_HEADING_OFFSET = 3


def _lower_headings(state: StateCore) -> None:
    for token in state.tokens:
        if token.type in {"heading_open", "heading_close"}:
            token.tag = f"h{min(int(token.tag[1]) + _HEADING_OFFSET, 6)}"


def _parser() -> MarkdownIt:
    # ``breaks`` keeps a single line break a line break, as the plain text
    # written before Markdown expects.
    md = MarkdownIt("commonmark", {"html": False, "linkify": False, "breaks": True}).disable("image").enable("table")
    md.use(tasklists_plugin)
    md.core.ruler.push("lower_headings", _lower_headings)
    return md


_MD = _parser()
# Captions: emphasis and links inside one line of text, never a block element.
_INLINE = MarkdownIt("zero", {"html": False, "linkify": False}).enable(["emphasis", "link", "escape", "entity"])

_TAGS = {
    "p",
    "br",
    "strong",
    "em",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "hr",
    "h4",
    "h5",
    "h6",
    "input",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
}
_INLINE_TAGS = {"strong", "em", "a"}
_CONTACT_TAGS = {"p", "br", "a"}
# A table column's alignment is the only style that survives.
_ATTRIBUTES = {"a": {"href"}, "ol": {"start"}, "input": {"checked"}, "th": {"style"}, "td": {"style"}}
_CLASSES = {"ul": {"contains-task-list"}, "li": {"task-list-item"}, "input": {"task-list-item-checkbox"}}
_REL = {"owner": "noopener noreferrer", "public": "noopener noreferrer nofollow"}
_SCHEMES = {"http", "https", "mailto"}


def _clean(rendered: str, tags: set[str], audience: Audience, schemes: set[str] = _SCHEMES) -> str:
    return nh3.clean(
        rendered,
        tags=tags,
        attributes={tag: names for tag, names in _ATTRIBUTES.items() if tag in tags},
        allowed_classes={tag: names for tag, names in _CLASSES.items() if tag in tags},
        tag_attribute_values={"input": {"type": {"checkbox"}}} if "input" in tags else None,
        # A checkbox is always inert, and a link always opens in a new tab.
        set_tag_attribute_values={
            tag: values
            for tag, values in {"input": {"disabled": "disabled"}, "a": {"target": "_blank"}}.items()
            if tag in tags
        },
        filter_style_properties={"text-align"},
        url_schemes=schemes,
        url_relative="deny",
        link_rel=_REL[audience],
    )


def render_markdown(source: str | None, audience: Audience = "public") -> str | None:
    """Sanitized HTML for Markdown source; ``None`` for no text.

    Public views, which people other than the owner read, add ``nofollow`` to links.
    """
    if not source or not source.strip():
        return None
    return _clean(_MD.render(source), _TAGS, audience)


def render_inline(source: str | None, audience: Audience = "public") -> str | None:
    """Sanitized HTML for inline-only Markdown (a caption): bold, italic and links, no blocks."""
    if not source or not source.strip():
        return None
    return _clean(_INLINE.renderInline(source.strip()), _INLINE_TAGS, audience)


# Contact details: web and email addresses, and phone numbers that start with
# ``+`` or ``0`` and hold at least seven digits. A date is never a number to call.
_CONTACT_LINK = re.compile(
    r"(?P<url>https?://[^\s<>\"]+[^\s<>\".,;:!?)\]])"
    r"|(?P<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)"
    r"|(?P<phone>(?<![\w+])\+?\d[\d ()./-]{5,}\d(?!\w))"
)
_DATE = re.compile(r"\d{1,4}([./-])\d{1,2}\1\d{1,4}")


def _contact_link(match: re.Match[str]) -> str:
    text = match.group(0)
    if match.group("url"):
        href = text
    elif match.group("email"):
        href = f"mailto:{text}"
    else:
        # "+32 (0)3 ..." is dialled without the bracketed trunk zero.
        digits = re.sub(r"\D", "", text.replace("(0)", ""))
        if not text.startswith(("+", "0")) or len(digits) < 7 or _DATE.fullmatch(text):
            return html.escape(text)
        href = f"tel:{'+' if text.startswith('+') else ''}{digits}"
    return f'<a href="{html.escape(href)}">{html.escape(text)}</a>'


def _contact_line(line: str) -> str:
    parts: list[str] = []
    position = 0
    for match in _CONTACT_LINK.finditer(line):
        parts.append(html.escape(line[position : match.start()]))
        parts.append(_contact_link(match))
        position = match.end()
    parts.append(html.escape(line[position:]))
    return "".join(parts)


def render_contact(source: str | None, audience: Audience = "owner") -> str | None:
    """Plain-text contact details as sanitized HTML: its line breaks kept, and its
    phone numbers (``tel:``), email addresses (``mailto:``) and web addresses linked."""
    if not source or not source.strip():
        return None
    paragraphs = [block.strip("\n") for block in re.split(r"\n\s*\n", source.strip().replace("\r\n", "\n"))]
    rendered = "".join(
        "<p>" + "<br>\n".join(_contact_line(line) for line in block.split("\n")) + "</p>\n" for block in paragraphs
    )
    return _clean(rendered, _CONTACT_TAGS, audience, _SCHEMES | {"tel"})


def render(source: str | None, format: Format = "markdown", audience: Audience = "owner") -> str | None:
    """The sanitized HTML of one field in its format; the one entry point for previews."""
    renderer = {"markdown": render_markdown, "inline": render_inline, "contact": render_contact}[format]
    return renderer(source, audience)


def markdown_text(source: str | None, format: Format = "markdown") -> str | None:
    """Markdown stripped to one line of plain text, for previews and cards."""
    if not source or not source.strip():
        return None
    if format == "contact":
        return " ".join(source.split())
    parser = _INLINE if format == "inline" else _MD
    parts: list[str] = []
    for token in parser.parse(source):
        if token.type == "inline":
            parts.extend(
                child.content if child.type in {"text", "code_inline"} else " "
                for child in token.children or []
                if child.type in {"text", "code_inline", "softbreak", "hardbreak"}
            )
        elif token.type in {"fence", "code_block"}:
            parts.append(token.content)
        parts.append(" ")
    return " ".join("".join(parts).split()) or None
