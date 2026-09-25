"""Transient, owner-only visit candidates derived from selected media.

Candidates are calculated for a single request and deliberately have no
database model.  They are a review aid, not a new source of canonical trip
data: the owner must still explicitly create or edit a reisupdate and choose a
place through the normal place flow.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import asin, cos, radians, sin, sqrt

from ..models import MediaAsset

GROUPING_WINDOW = timedelta(hours=2)
GPS_AGREEMENT_METRES = 500


@dataclass(frozen=True)
class CandidateLocation:
    latitude: float
    longitude: float
    media_asset_ids: list[str]


@dataclass(frozen=True)
class VisitCandidate:
    id: str
    media_asset_ids: list[str]
    starts_at: datetime | None
    ends_at: datetime | None
    time_options: list[tuple[str, datetime]]
    location_options: list[CandidateLocation]


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _gps(asset: MediaAsset) -> tuple[float, float] | None:
    value = (asset.raw_metadata.get("exif") or {}).get("gps")
    if not isinstance(value, dict):
        return None
    latitude, longitude = value.get("latitude"), value.get("longitude")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        return None
    return float(latitude), float(longitude)


def _distance_metres(first: tuple[float, float], second: tuple[float, float]) -> float:
    """Great-circle distance; enough precision for the review-only threshold."""
    latitude_delta = radians(second[0] - first[0])
    longitude_delta = radians(second[1] - first[1])
    a = sin(latitude_delta / 2) ** 2 + cos(radians(first[0])) * cos(radians(second[0])) * sin(longitude_delta / 2) ** 2
    return 6_371_000 * 2 * asin(sqrt(a))


def _location_options(assets: list[MediaAsset]) -> list[CandidateLocation]:
    """Keep materially different GPS readings as separate explicit choices.

    A location cluster is anchored to its first reading; every further reading
    must be within 500 m of that raw reading.  We return that original reading
    rather than averaging coordinates, so the review UI never invents a new
    precise location from EXIF.
    """
    clusters: list[tuple[tuple[float, float], list[str]]] = []
    for asset in assets:
        coordinate = _gps(asset)
        if coordinate is None:
            continue
        for reference, ids in clusters:
            if _distance_metres(reference, coordinate) <= GPS_AGREEMENT_METRES:
                ids.append(asset.id)
                break
        else:
            clusters.append((coordinate, [asset.id]))
    return [CandidateLocation(latitude=coordinate[0], longitude=coordinate[1], media_asset_ids=ids) for coordinate, ids in clusters]


def build_visit_candidates(assets: list[MediaAsset]) -> tuple[list[VisitCandidate], list[str]]:
    """Group selected media into reviewable visits without writing anything.

    Timed media are sorted and placed in a two-hour window measured from the
    first item in each group. Media without a capture timestamp form their own
    candidate when they carry GPS; media with neither signal are returned as
    unavailable rather than being guessed into a visit.
    """
    eligible = [asset for asset in assets if asset.captured_at is not None or _gps(asset) is not None]
    unavailable = [asset.id for asset in assets if asset not in eligible]
    timed = sorted((asset for asset in eligible if asset.captured_at is not None), key=lambda asset: _utc(asset.captured_at))
    groups: list[list[MediaAsset]] = []
    current: list[MediaAsset] = []
    start: datetime | None = None
    for asset in timed:
        captured_at = _utc(asset.captured_at)
        if start is None or captured_at - start <= GROUPING_WINDOW:
            current.append(asset)
            start = captured_at if start is None else start
        else:
            groups.append(current)
            current, start = [asset], captured_at
    if current:
        groups.append(current)
    groups.extend([asset] for asset in eligible if asset.captured_at is None)

    candidates = []
    for group in groups:
        time_options = [(asset.id, _utc(asset.captured_at)) for asset in group if asset.captured_at is not None]
        ids = [asset.id for asset in group]
        candidates.append(
            VisitCandidate(
                id="candidate-" + "-".join(sorted(ids)),
                media_asset_ids=ids,
                starts_at=time_options[0][1] if time_options else None,
                ends_at=time_options[-1][1] if time_options else None,
                time_options=time_options,
                location_options=_location_options(group),
            )
        )
    return candidates, unavailable
