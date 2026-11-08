"""Finished files are transient input, never objects or records. No parser diagnostics escape."""

import json
import math
import re
import xml.etree.ElementTree as ET

from .schemas import GeoJsonLineString

MAX_BYTES = 2 * 1024 * 1024
MAX_POINTS = 20_000
MAX_DRAFT_POINTS = 500


def approximate_line(data: bytearray, start: int, end: int) -> GeoJsonLineString:
    """Select by position in file order; discard every field except a rounded pair."""
    text = data.decode("utf-8-sig")
    points: list[tuple[float, float]] = []

    def add(lon, lat):
        if len(points) >= MAX_POINTS or isinstance(lon, bool) or isinstance(lat, bool):
            raise ValueError()
        lon, lat = float(lon), float(lat)
        if not math.isfinite(lon) or not math.isfinite(lat) or not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError()
        points.append((lon, lat))

    if text.lstrip().startswith("<"):
        # UTF-8 only; no DTD, entities, alternate encoding or external references.
        encoding = re.search(r"encoding\s*=\s*[\"']([^\"']+)", text.split("?>", 1)[0], re.I)
        if "<!" in text or encoding and encoding[1].lower() not in {"utf-8", "utf8"}:
            raise ValueError()
        root = ET.fromstring(text)
        if root.tag.rsplit("}", 1)[-1] != "gpx":
            raise ValueError()
        stack = [(root, 0)]
        while stack:
            node, depth = stack.pop()
            if depth > 32:
                raise ValueError()
            if node.tag.rsplit("}", 1)[-1] in {"trkpt", "rtept"}:
                add(node.attrib["lon"], node.attrib["lat"])
            stack.extend((child, depth + 1) for child in reversed(node))
    else:
        # Bound nesting before the recursive JSON decoder. Ignore brackets inside strings.
        depth = 0
        quoted = escaped = False
        for char in text:
            if quoted:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    quoted = False
            elif char == '"':
                quoted = True
            elif char in "[{":
                depth += 1
                if depth > 32:
                    raise ValueError()
            elif char in "]}":
                depth -= 1
        value = json.loads(text)

        def geometry(obj):
            kind = obj.get("type")
            if kind == "Feature":
                geometry(obj["geometry"])
            elif kind == "FeatureCollection":
                for feature in obj["features"]:
                    geometry(feature)
            elif kind in {"LineString", "MultiLineString"}:
                lines = [obj["coordinates"]] if kind == "LineString" else obj["coordinates"]
                for line in lines:
                    if not isinstance(line, list):
                        raise ValueError()
                    for pair in line:
                        if (
                            not isinstance(pair, list)
                            or len(pair) < 2
                            or any(type(n) not in (int, float) for n in pair[:2])
                        ):
                            raise ValueError()
                        add(pair[0], pair[1])
            else:
                raise ValueError()

        if isinstance(value, dict) and "type" in value:
            geometry(value)
        elif (isinstance(value, dict) and "semanticSegments" in value) or (
            isinstance(value, list) and any(isinstance(item, dict) and "timelinePath" in item for item in value)
        ):
            segments = value["semanticSegments"] if isinstance(value, dict) else value
            for segment in segments:
                for item in segment.get("timelinePath", []):
                    pair = item["point"].removeprefix("geo:").replace("°", "").split(",")
                    add(pair[1], pair[0])
        else:
            items = value if isinstance(value, list) else value.get("locations", value.get("points", []))
            for item in items:
                if "latitudeE7" in item:
                    add(item["longitudeE7"] / 1e7, item["latitudeE7"] / 1e7)
                elif "lat" in item and "lon" in item:
                    add(item["lon"], item["lat"])
                else:
                    add(item["longitude"], item["latitude"])
    if not 0 <= start < end <= 100 or len(points) < 2:
        raise ValueError()
    selected = points[(len(points) - 1) * start // 100 : (len(points) - 1) * end // 100 + 1]
    # Radial simplification at ~1 km plus a deterministic uniform cap, preserving endpoints.
    rounded: list[tuple[float, float]] = []
    for lon, lat in selected:
        point = (round(lon, 2), round(lat, 2))
        if not rounded or math.dist(rounded[-1], point) >= 0.01:
            rounded.append(point)
    last = (round(selected[-1][0], 2), round(selected[-1][1], 2))
    if rounded and rounded[-1] != last:
        rounded.append(last)
    if len(rounded) > MAX_DRAFT_POINTS:
        rounded = [rounded[i * (len(rounded) - 1) // (MAX_DRAFT_POINTS - 1)] for i in range(MAX_DRAFT_POINTS)]
    return GeoJsonLineString(coordinates=rounded)
