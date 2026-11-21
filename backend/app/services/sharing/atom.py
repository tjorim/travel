"""Text-only Atom from an already authorized projection; never serialize arbitrary fields."""

from datetime import UTC, datetime
from xml.etree.ElementTree import Element, SubElement, tostring

ATOM = "http://www.w3.org/2005/Atom"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"


def marked(element: Element, language: str | None) -> None:
    """Say what language a text is in when it is not the feed's: the visitor's requested one was empty."""
    if language:
        element.set(XML_LANG, language)


def atom_document(document: dict, identity: str, language: str | None = None) -> bytes:
    # Atom requires an exact updated instant. This is representation retrieval time,
    # not a claimed story date; coarse dates appear only as literal text in content.
    retrieved = datetime.now(UTC).isoformat()

    def add(parent: Element, name: str, text: str) -> Element:
        child = SubElement(parent, f"{{{ATOM}}}{name}")
        # XML 1.0 disallows control characters, even in escaped text.
        child.text = "".join(
            c
            for c in text
            if c in "\t\n\r" or 0x20 <= ord(c) <= 0xD7FF or 0xE000 <= ord(c) <= 0xFFFD or 0x10000 <= ord(c) <= 0x10FFFF
        )
        return child

    root = Element(f"{{{ATOM}}}feed")
    if language:
        root.set(XML_LANG, language)
    add(root, "id", identity)
    marked(add(root, "title", document.get("title") or "Travel"), document.get("title_lang"))
    add(root, "updated", retrieved)
    author = SubElement(root, f"{{{ATOM}}}author")
    add(author, "name", "Travel")
    for update in document["updates"]:
        entry = SubElement(root, f"{{{ATOM}}}entry")
        add(entry, "id", f"{identity}:{update['id']}")
        marked(add(entry, "title", update["title"] or "Travel"), update.get("title_lang"))
        add(entry, "updated", retrieved)
        place = update.get("place") or {}
        text = "\n\n".join(
            str(value) for value in (update.get("story_date"), place.get("label"), update.get("body")) if value
        )
        content = add(entry, "content", text)
        content.set("type", "text")
        marked(content, update.get("body_lang"))
    return tostring(root, encoding="utf-8", xml_declaration=True)
