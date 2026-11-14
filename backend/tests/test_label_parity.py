"""Copy kept outside the interface catalogue must stay complete in every locale.

The frontend catalogue is checked by ``pnpm check-message-parity``. The PDF renderer keeps its
own labels and the Home Assistant integration ships its own translations; neither is covered
by that script, so this test applies the same rule: every locale defines the same keys and
the same placeholders (issue 371).
"""

import json
import re
from pathlib import Path

from app import pdf_renderer

TRANSLATIONS = Path(__file__).resolve().parents[2] / "custom_components/travel/translations"
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def flatten(node: object, prefix: str = "") -> dict[str, str]:
    if isinstance(node, dict):
        return {key: text for name, child in node.items() for key, text in flatten(child, f"{prefix}{name}.").items()}
    assert isinstance(node, str), f"{prefix} is not a string"
    return {prefix.rstrip("."): node}


def test_pdf_labels_define_the_same_keys_in_every_locale():
    assert set(pdf_renderer.LABELS) == {"en", "nl"}
    assert set(pdf_renderer.LABELS["en"]) == set(pdf_renderer.LABELS["nl"])
    for locale, labels in pdf_renderer.LABELS.items():
        for key, text in labels.items():
            assert text.strip(), f"{locale}.{key} is empty"


def test_pdf_field_and_value_labels_have_both_locales():
    for key, pair in pdf_renderer.FIELD_LABELS.items():
        assert len(pair) == 2 and all(text.strip() for text in pair), key
    for field, values in pdf_renderer.VALUE_LABELS.items():
        for value, pair in values.items():
            assert len(pair) == 2 and all(text.strip() for text in pair), f"{field}.{value}"


def test_home_assistant_translations_match_across_locales():
    catalogues = {
        path.stem: flatten(json.loads(path.read_text(encoding="utf-8"))) for path in TRANSLATIONS.glob("*.json")
    }
    assert set(catalogues) == {"en", "nl"}
    base = catalogues["en"]
    other = catalogues["nl"]
    assert set(base) == set(other), sorted(set(base) ^ set(other))
    for key, text in base.items():
        assert sorted(PLACEHOLDER.findall(text)) == sorted(PLACEHOLDER.findall(other[key])), key
