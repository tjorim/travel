"""Markdown for long-form text fields, rendered once, on the server.

Records store the owner's Markdown source, never HTML. This module is the one
render path for every view: the owner app, the public page and share links all
receive the same sanitized HTML, so no client needs a parser or sanitizer of
its own.

Raw HTML is disabled in the parser and the output is sanitized anyway, with a
small allowlist: paragraphs, emphasis, headings, lists, links, blockquotes,
code and rules. Headings move three levels down (``#`` becomes ``h4``) so notes
never outrank the page and section headings around them. Task-list items
(``- [ ]``, ``- [x]``) render as disabled checkboxes: they are display-only and
never create or change trip tasks.
"""

from typing import Literal

import nh3
from markdown_it import MarkdownIt
from markdown_it.rules_core import StateCore
from mdit_py_plugins.tasklists import tasklists_plugin

Audience = Literal["owner", "public"]

_HEADING_OFFSET = 3


def _lower_headings(state: StateCore) -> None:
    for token in state.tokens:
        if token.type in {"heading_open", "heading_close"}:
            token.tag = f"h{min(int(token.tag[1]) + _HEADING_OFFSET, 6)}"


def _parser() -> MarkdownIt:
    # ``breaks`` keeps a single line break a line break, as the plain text
    # written before Markdown expects.
    md = MarkdownIt("commonmark", {"html": False, "linkify": False, "breaks": True}).disable("image")
    md.use(tasklists_plugin)
    md.core.ruler.push("lower_headings", _lower_headings)
    return md


_MD = _parser()

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
}
_ATTRIBUTES = {"a": {"href"}, "ol": {"start"}, "input": {"checked"}}
_CLASSES = {"ul": {"contains-task-list"}, "li": {"task-list-item"}, "input": {"task-list-item-checkbox"}}
_REL = {"owner": "noopener noreferrer", "public": "noopener noreferrer nofollow"}


def render_markdown(source: str | None, audience: Audience = "public") -> str | None:
    """Sanitized HTML for Markdown source; ``None`` for no text.

    Public views, which people other than the owner read, add ``nofollow`` to links.
    """
    if not source or not source.strip():
        return None
    return nh3.clean(
        _MD.render(source),
        tags=_TAGS,
        attributes=_ATTRIBUTES,
        allowed_classes=_CLASSES,
        tag_attribute_values={"input": {"type": {"checkbox"}}},
        # A checkbox is always inert, and a link always opens in a new tab.
        set_tag_attribute_values={"input": {"disabled": "disabled"}, "a": {"target": "_blank"}},
        url_schemes={"http", "https", "mailto"},
        url_relative="deny",
        link_rel=_REL[audience],
    )


def markdown_text(source: str | None) -> str | None:
    """Markdown stripped to one line of plain text, for previews and cards."""
    if not source or not source.strip():
        return None
    parts: list[str] = []
    for token in _MD.parse(source):
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
