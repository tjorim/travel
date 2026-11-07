"""How precisely an audience reads dates: the one rule every visitor-facing date follows.

Precision is chosen in two places and the coarser value always wins:

* the audience (the public view, a hidden link or a collection member) may set
  ``defaults.date_precision`` in its share scope: a cap on every date it shows;
* a visit or stay may set its own ``share_date_precision``; ``None`` follows the
  audience. A reisupdate always has its own ``date_precision``;
* a route has no setting of its own: its departure day follows the audience's cap alone (``route_precision``).

A record whose own value and audience setting are both absent falls back to
``month``, the conservative default every new record has always had, so an
audience never shows a finer date because nobody decided. A route is the one exception: with no audience cap it
keeps the full day it has always shown.
"""

from collections import Counter
from collections.abc import Iterable, Mapping
from typing import Any

DEFAULT_PRECISION = "month"
# Finest to coarsest; a larger rank hides more.
_RANK = {"day": 0, "month": 1, "year": 2}
PRECISION_LENGTH = {"day": 10, "month": 7, "year": 4}


def audience_precision(scope: dict) -> str | None:
    """The date precision this audience caps its dates at, or ``None`` when it sets none.

    A stored value this code does not know (a hand-edited scope) is read as
    ``year``, the coarsest, never as no cap."""
    defaults = scope.get("defaults")
    value = defaults.get("date_precision") if isinstance(defaults, dict) else None
    if value is None:
        return None
    return value if value in _RANK else "year"


def coarser(*values: str | None) -> str | None:
    """The coarsest of the values that are set, or ``None`` when none is. An unknown value reads as ``year``."""
    chosen = [value if value in _RANK else "year" for value in values if value is not None]
    return max(chosen, key=_RANK.__getitem__) if chosen else None


def effective_precision(own: str | None, scope_or_cap: dict | str | None) -> str:
    """What an audience may show of a visit or stay: the coarser of its own value and the audience setting.

    Neither set: ``month``."""
    cap = audience_precision(scope_or_cap) if isinstance(scope_or_cap, dict) else scope_or_cap
    return coarser(own, cap) or DEFAULT_PRECISION


def route_precision(scope_or_cap: dict | str | None) -> str:
    """What an audience may show of a route's departure day: its date setting, or ``day`` when it sets none.

    A route has no setting of its own, so the audience's cap alone decides. An audience that sets no cap keeps
    the full day a route has always shown (unlike a visit or stay, which fall back to ``month``)."""
    cap = audience_precision(scope_or_cap) if isinstance(scope_or_cap, dict) else scope_or_cap
    return cap or "day"


def is_finer(precision: str, than: str) -> bool:
    return _RANK[precision] < _RANK[than]


def own_value(record: Any) -> str | None:
    value = record.share_date_precision
    return value.value if value is not None else None


def precision_summary(records: Mapping[str, Iterable[Any]], scope: dict) -> dict[str, dict[str, Any]]:
    """Per kind (``visit``, ``stay``, ``route``): how many delivered records read at each precision.

    ``limited_by_record`` counts the records held coarser than the audience alone would allow by
    their own setting; an audience with no setting allows days. ``default_applied`` counts those
    that follow an audience that sets nothing, so they read at the ``month`` default. Undated
    visits and routes show no date and are left out. A route has no setting of its own: it reads at the
    audience's cap, or by day when the audience sets none, so it is never limited or defaulted."""
    cap = audience_precision(scope)
    allowed = cap or "day"
    summary: dict[str, dict[str, Any]] = {}
    for kind in ("visit", "stay", "route"):
        counts: Counter[str] = Counter()
        limited = unset = 0
        for record in records.get(kind, ()):
            if kind == "visit" and record.starts_on is None:
                continue
            if kind == "route":
                if record.departs_on is not None:
                    counts[route_precision(cap)] += 1
                continue
            own = own_value(record)
            counts[effective_precision(own, cap)] += 1
            if own is not None and is_finer(allowed, own):
                limited += 1
            if own is None and cap is None:
                unset += 1
        summary[kind] = {
            "by_precision": {key: counts[key] for key in _RANK if counts[key]},
            "limited_by_record": limited,
            "default_applied": unset,
        }
    return summary
