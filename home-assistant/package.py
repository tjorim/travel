"""Build the HACS release archive with only the owned integration sources."""

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custom_components/travel"


def build(target: Path | None = None):
    target = target or ROOT / "home-assistant/dist/travel.zip"
    target.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(target, "w", ZIP_DEFLATED) as archive:
        for path in sorted(SOURCE.rglob("*")):
            if (
                path.is_file()
                and (
                    path.suffix in {".py", ".json"}
                    or path.relative_to(SOURCE).as_posix() in {"brand/icon.png", "LICENSE"}
                )
                and "__pycache__" not in path.parts
            ):
                info = ZipInfo(path.relative_to(SOURCE).as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, path.read_bytes())
    with ZipFile(target) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["domain"] == "travel" and manifest["version"]
        assert "config_flow.py" in archive.namelist()
    return target


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Archive path (default: dist/travel.zip)")
    print(build(parser.parse_args().output))
