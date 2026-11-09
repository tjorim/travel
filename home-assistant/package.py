"""Build the HACS release archive with only the owned integration sources."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custom_components/travel"


def build():
    target = ROOT / "home-assistant/dist/travel.zip"
    target.parent.mkdir(exist_ok=True)
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for path in sorted(SOURCE.rglob("*")):
            if path.is_file() and path.suffix in {".py", ".json"} and "__pycache__" not in path.parts:
                archive.write(path, path.relative_to(SOURCE))
    with ZipFile(target) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["version"] == "0.2.0"
        assert "config_flow.py" in archive.namelist()
    return target


if __name__ == "__main__":
    print(build())
