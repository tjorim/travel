"""Exercise the source privacy gate's public contract with synthetic inputs."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("source_privacy", Path(__file__).with_name("check-source-privacy.py"))
assert spec and spec.loader
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class SourcePrivacyTests(unittest.TestCase):
    def test_operational_files_are_rejected(self):
        for path in (
            "backend/travel.db",
            "uploads/ticket.pdf",
            "backups/repo.bundle",
            "frontend/.env",
            "docs/screenshots/review.png",
        ):
            with self.subTest(path=path):
                self.assertTrue(privacy.findings(path, b"synthetic"))

    def test_source_and_example_configuration_are_allowed(self):
        for path in ("backend/app/main.py", "frontend/public/icon.svg", "api.env.example", "frontend/.env.example"):
            with self.subTest(path=path):
                self.assertEqual(privacy.findings(path, b"synthetic"), [])

    def test_retired_archive_cannot_return(self):
        self.assertTrue(privacy.findings("dist/example/data.json", b"{}"))

    def test_credentials_are_detected_without_returning_the_value(self):
        synthetic = b"gh" + b"p_" + b"x" * 36
        result = privacy.findings("frontend/src/config.ts", synthetic)
        self.assertEqual(result, ["credential-shaped content"])
        self.assertNotIn(synthetic.decode(), " ".join(result))


if __name__ == "__main__":
    unittest.main()
