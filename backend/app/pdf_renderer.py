"""Isolated ReportLab worker. No network, HTML, external fonts or user file paths."""

import json
import resource
import sys
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

# Limits are installed before loading the PDF/image libraries (Linux production).
if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))

from PIL import Image as PillowImage  # noqa: E402
from reportlab import __file__ as reportlab_file  # noqa: E402
from reportlab.lib.styles import ParagraphStyle  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402
from reportlab.pdfbase.ttfonts import TTFont  # noqa: E402
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer  # noqa: E402

LABELS = {
    "en": {
        "story": "Story",
        "itinerary": "Itinerary",
        "visits": "Visits",
        "stays": "Stays",
        "routes": "Routes",
        "places": "Places",
        "private": "PRIVATE - contains private owner information. Review before sharing.",
        "audience": "Audience view - saved copies cannot be revoked.",
        "photos": "Photos",
        "untitled": "Trip",
    },
    "nl": {
        "story": "Reisverhaal",
        "itinerary": "Reisplan",
        "visits": "Bezoeken",
        "stays": "Verblijven",
        "routes": "Trajecten",
        "places": "Plaatsen",
        "private": "PRIVÉ - bevat privégegevens van de eigenaar. Controleer vóór het delen.",
        "audience": "Publieksweergave - opgeslagen kopieën kunnen niet worden ingetrokken.",
        "photos": "Foto’s",
        "untitled": "Reis",
    },
}
# Explicit display allowlist: unknown projection fields never become PDF text.
FIELDS = (
    "title",
    "label",
    "story_date",
    "occurred_at",
    "starts_on",
    "ends_on",
    "check_in_date",
    "check_out_date",
    "departs_on",
    "departs_at",
    "arrives_at",
    "start_time",
    "end_time",
    "departure_timezone",
    "arrival_timezone",
    "timezone",
    "property_name",
    "mode",
    "carrier",
    "service_reference",
    "travel_class",
    "booking_reference",
    "contact_details",
    "website_url",
    "address_line1",
    "address_line2",
    "postal_code",
    "locality",
    "summary",
    "body",
    "notes",
    "private_notes",
    "check_in_time",
    "check_out_time",
    "status",
    "kind",
    "latitude",
    "longitude",
    "admin_area",
    "country_code",
)

# A second allowlist at the PDF boundary, independent of the richer private layout.
AUDIENCE_FIELDS = (
    "title",
    "label",
    "story_date",
    "starts_on",
    "ends_on",
    "departs_on",
    "departs_at",
    "arrives_at",
    "start_time",
    "end_time",
    "departure_timezone",
    "arrival_timezone",
    "timezone",
    "mode",
    "carrier",
    "service_reference",
    "summary",
    "body",
)


FIELD_LABELS = {
    "story_date": ("Datum", "Date"),
    "occurred_at": ("Tijdstip", "Time"),
    "starts_on": ("Van", "From"),
    "ends_on": ("Tot", "Until"),
    "check_in_date": ("Incheckdatum", "Check-in date"),
    "check_out_date": ("Uitcheckdatum", "Check-out date"),
    "check_in_time": ("Inchecktijd", "Check-in time"),
    "check_out_time": ("Uitchecktijd", "Check-out time"),
    "departs_on": ("Vertrekdatum", "Departure date"),
    "departs_at": ("Vertrek", "Departure"),
    "arrives_at": ("Aankomst", "Arrival"),
    "start_time": ("Begintijd", "Start time"),
    "end_time": ("Eindtijd", "End time"),
    "departure_timezone": ("Tijdzone vertrek", "Departure timezone"),
    "arrival_timezone": ("Tijdzone aankomst", "Arrival timezone"),
    "timezone": ("Tijdzone", "Timezone"),
    "property_name": ("Accommodatie", "Accommodation"),
    "mode": ("Vervoer", "Transport"),
    "carrier": ("Vervoerder", "Carrier"),
    "service_reference": ("Dienstnummer", "Service reference"),
    "travel_class": ("Reisklasse", "Travel class"),
    "booking_reference": ("Boekingsreferentie", "Booking reference"),
    "contact_details": ("Contactgegevens", "Contact details"),
    "website_url": ("Website", "Website"),
    "notes": ("Notities", "Notes"),
    "private_notes": ("Privénotities", "Private notes"),
    "status": ("Status", "Status"),
    "kind": ("Soort", "Kind"),
    "latitude": ("Breedtegraad", "Latitude"),
    "longitude": ("Lengtegraad", "Longitude"),
    "admin_area": ("Regio", "Region"),
    "country_code": ("Landcode", "Country code"),
}


VALUE_LABELS = {
    "mode": {
        "flight": ("Vliegtuig", "Flight"),
        "train": ("Trein", "Train"),
        "bus": ("Bus", "Bus"),
        "ferry": ("Veerboot", "Ferry"),
        "car": ("Auto", "Car"),
        "bike": ("Fiets", "Bike"),
        "walk": ("Te voet", "Walk"),
        "other": ("Anders", "Other"),
    },
    "status": {
        "idea": ("Idee", "Idea"),
        "planned": ("Gepland", "Planned"),
        "confirmed": ("Bevestigd", "Confirmed"),
        "cancelled": ("Geannuleerd", "Cancelled"),
    },
    "kind": {"free": ("Vrije tijd", "Free time"), "work": ("Werk", "Work")},
}


class TripDocument(SimpleDocTemplate):
    """Reader bookmarks and language metadata; this is not a tagged PDF/UA tree."""

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in {"Title", "Heading"}:
            self.heading_number = getattr(self, "heading_number", 0) + 1
            key = f"heading-{self.heading_number}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.getPlainText(), key, level=0)


def render(source: Path, output: Path) -> None:
    payload = json.loads(source.read_text(encoding="utf-8"))
    data, photos, request = payload["data"], payload["photos"], payload["request"]
    labels = LABELS[request["locale"]]
    font_dir = Path(reportlab_file).parent / "fonts"
    pdfmetrics.registerFont(TTFont("Travel", str(font_dir / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("TravelBold", str(font_dir / "VeraBd.ttf")))
    normal = ParagraphStyle("Body", fontName="Travel", fontSize=10, leading=15, spaceAfter=8)
    heading = ParagraphStyle(
        "Heading", parent=normal, fontName="TravelBold", fontSize=16, leading=21, spaceBefore=14, keepWithNext=True
    )
    title = ParagraphStyle("Title", parent=heading, fontSize=24, leading=29)
    story: list[Any] = []
    fields = AUDIENCE_FIELDS if request["view"] == "audience" else FIELDS

    def text(value, style=normal):
        if value is not None and value != "":
            # Escape ALL markup, including Markdown HTML and remote <img> tags.
            story.append(Paragraph(escape(str(value)).replace("\n", "<br/>"), style))

    def field(record, key, style=normal):
        value = record.get(key)
        if value is None or value == "":
            return
        if key in VALUE_LABELS and value in VALUE_LABELS[key]:
            value = VALUE_LABELS[key][value][0 if request["locale"] == "nl" else 1]
        if key in FIELD_LABELS:
            label = FIELD_LABELS[key][0 if request["locale"] == "nl" else 1]
            value = f"{label}: {value}"
        text(value, style)

    text(data.get("title") or labels["untitled"], title)
    text(labels[request["view"]])
    text(data.get("summary"))
    for value in (data.get("dates") or {}).values():
        if value and value not in ("day", "month", "year"):
            text(value)
    if request["content"] in ("story", "both"):
        text(labels["story"], heading)
        for update in data["updates"]:
            for key in fields:
                field(update, key, heading if key == "title" else normal)
            for key in ("place", "location"):
                text((update.get(key) or {}).get("label"))
        if photos:
            text(labels["photos"], heading)
        for media in data["media"]:
            path = photos.get(media["id"])
            if not path:
                continue
            with PillowImage.open(path) as image:
                if image.width * image.height > 20_000_000:
                    raise ValueError("Photo pixel limit exceeded")
                image.thumbnail((1600, 1600))
                normalized = Path(path + ".jpg")
                image.convert("RGB").save(normalized, "JPEG", quality=85)
                width, height = image.size
            scale = min(460 / width, 420 / height, 1)
            story.append(Image(str(normalized), width=width * scale, height=height * scale))
            text(media.get("alt_text"))
            text(media.get("caption"))
            story.append(Spacer(1, 12))
    if request["content"] in ("itinerary", "both"):
        text(labels["itinerary"], heading)
        for section in ("visits", "stays", "routes", "places"):
            if data[section]:
                text(labels[section], heading)
            for record in data[section]:
                for key in fields:
                    field(record, key)
                for key in ("place", "location", "departure", "arrival", "departure_location", "arrival_location"):
                    text((record.get(key) or {}).get("label"))
                story.append(Spacer(1, 10))

    def page(canvas, doc):
        canvas.setFont("Travel", 9)
        canvas.drawRightString(540, 30, str(doc.page))
        if request["view"] == "private":
            canvas.drawString(48, 30, "PRIVÉ" if request["locale"] == "nl" else "PRIVATE")

    TripDocument(
        str(output),
        title=data.get("title") or labels["untitled"],
        author="",
        lang=request["locale"],
        leftMargin=48,
        rightMargin=48,
        topMargin=40,
        bottomMargin=48,
    ).build(story, onFirstPage=page, onLaterPages=page)


if __name__ == "__main__":
    render(Path(sys.argv[1]), Path(sys.argv[2]))
