"""The release asset must be reproducible and ready for HACS extraction."""

import importlib.util
import json
from pathlib import Path
from zipfile import ZipFile

spec = importlib.util.spec_from_file_location("travel_package", Path(__file__).parents[1] / "package.py")
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


def test_release_archive(tmp_path):
    first = package.build(tmp_path / "first.zip")
    second = package.build(tmp_path / "second.zip")
    assert first.read_bytes() == second.read_bytes()
    with ZipFile(first) as archive:
        names = archive.namelist()
        assert names == sorted(names)
        assert {
            "__init__.py",
            "config_flow.py",
            "todo.py",
            "live_location.py",
            "translations/en.json",
            "brand/icon.png",
            "LICENSE",
        } <= set(names)
        assert all(not name.startswith(("/", "custom_components/")) and ".." not in name.split("/") for name in names)
        assert all(
            (name.endswith((".py", ".json")) or name in {"brand/icon.png", "LICENSE"}) and "__pycache__" not in name
            for name in names
        )
        assert json.loads(archive.read("manifest.json")) == json.loads((package.SOURCE / "manifest.json").read_text())
