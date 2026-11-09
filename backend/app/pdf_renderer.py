"""Isolated tagged PDF worker. Generated markup and approved local resources only."""

import json
import os
import resource
import sys
from html import escape
from pathlib import Path

if __name__ == "__main__":
    # Fontconfig caches belong to the same disposable export directory.
    os.environ["XDG_CACHE_HOME"] = str(Path(sys.argv[1]).parent / "font-cache")
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))

from PIL import Image as PillowImage  # noqa: E402
from reportlab import __file__ as reportlab_file  # noqa: E402
from weasyprint import HTML  # noqa: E402
from weasyprint.text.fonts import FontConfiguration  # noqa: E402
from weasyprint.urls import URLFetcher, URLFetcherResponse  # noqa: E402

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


def render(source: Path, output: Path) -> None:
    payload = json.loads(source.read_text(encoding="utf-8"))
    data, photos, request = payload["data"], payload["photos"], payload["request"]
    labels = LABELS[request["locale"]]
    font_dir = Path(reportlab_file).parent / "fonts"
    resources = {
        "https://travel.invalid/regular.ttf": (font_dir / "Vera.ttf", "font/ttf"),
        "https://travel.invalid/bold.ttf": (font_dir / "VeraBd.ttf", "font/ttf"),
    }

    class LocalResources(URLFetcher):
        def fetch(self, url, headers=None):
            # Never delegate: no network, data URLs, redirects or arbitrary paths.
            if url not in resources:
                raise ValueError("PDF resource is not approved")
            path, mime = resources[url]
            return URLFetcherResponse(url, body=path.read_bytes(), headers={"Content-Type": mime})

    normal, heading, title = "p", "h2", "h1"
    story: list[str] = []
    fields = AUDIENCE_FIELDS if request["view"] == "audience" else FIELDS

    def text(value, style=normal):
        if value is not None and value != "":
            story.append(f"<{style}>{escape(str(value)).replace(chr(10), '<br>')}</{style}>")

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
                field(update, key, "h3" if key == "title" else normal)
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
            url = f"https://travel.invalid/photo-{len(resources)}.jpg"
            resources[url] = (normalized, "image/jpeg")
            alt = escape(str(media.get("alt_text") or ""), quote=True)
            story.append('<div class="photo">')
            story.append(f'<img src="{url}" alt="{alt}" style="width:{width * scale}pt;height:{height * scale}pt">')
            text(media.get("alt_text"))
            text(media.get("caption"))
            story.append("</div>")

    if request["content"] in ("itinerary", "both"):
        text(labels["itinerary"], heading)
        for section in ("visits", "stays", "routes", "places"):
            if data[section]:
                text(labels[section], "h3")
            for record in data[section]:
                for key in fields:
                    field(record, key)
                for key in ("place", "location", "departure", "arrival", "departure_location", "arrival_location"):
                    text((record.get(key) or {}).get("label"))

    private = "PRIVÉ" if request["locale"] == "nl" else "PRIVATE"
    footer = private if request["view"] == "private" else ""
    css = """
        @font-face { font-family: Travel; src: url(https://travel.invalid/regular.ttf) }
        @font-face { font-family: Travel; font-weight: bold; src: url(https://travel.invalid/bold.ttf) }
        @page { size: A4; margin: 40pt 48pt 48pt;
          @bottom-right { content: counter(page); font: 9pt Travel }
          @bottom-left { content: "FOOTER"; font: 9pt Travel }
        }
        body { font: 10pt/1.5 Travel }
        p { margin: 0 0 8pt; overflow-wrap: anywhere }
        h1, h2, h3 { font-weight: bold; break-after: avoid; overflow-wrap: anywhere }
        h1 { font-size: 24pt } h2 { font-size: 16pt } h3 { font-size: 12pt }
        .photo { break-inside: avoid }
        img { display: block; max-width: 100%; object-fit: contain; margin: 8pt 0 }
    """.replace("FOOTER", footer)
    document = (
        f'<html lang="{request["locale"]}"><head><meta charset="utf-8">'
        f"<title>{escape(data.get('title') or labels['untitled'])}</title>"
        f"<style>{css}</style></head><body>{''.join(story)}</body></html>"
    )
    # Use the supported accessibility profile; human validation is still required.
    HTML(string=document, url_fetcher=LocalResources(fail_on_errors=True, allowed_protocols=[])).write_pdf(
        output, pdf_variant="pdf/ua-1", font_config=FontConfiguration()
    )


if __name__ == "__main__":
    render(Path(sys.argv[1]), Path(sys.argv[2]))
