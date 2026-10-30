import datetime
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("audit", Path(__file__).with_name("dependency-audit.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditPolicyTests(unittest.TestCase):
    def test_severity_gate(self):
        for severity in ("low", "moderate", "medium", "high", "critical", "unknown"):
            with self.subTest(severity=severity):
                finding = {"package": "synthetic", "ids": ["GHSA-example"], "severity": severity}
                self.assertEqual(
                    audit.evaluate([finding], [], datetime.date(2026, 10, 30)),
                    severity in {"high", "critical", "unknown"},
                )

    def test_exceptions_match_alias_and_expire(self):
        finding = {"package": "synthetic", "ids": ["PYSEC-example", "GHSA-example"], "severity": "high"}
        exception = {"id": "GHSA-example", "expires": "2026-10-30"}
        self.assertFalse(audit.evaluate([finding], [exception], datetime.date(2026, 10, 30)))
        self.assertTrue(audit.evaluate([finding], [exception], datetime.date(2026, 10, 31)))
        exception["id"] = "GHSA-other"
        self.assertTrue(audit.evaluate([finding], [exception], datetime.date(2026, 10, 30)))

    def test_python_severity_uses_ghsa_alias(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"severity": "high"}'
        with (
            patch.dict(audit.os.environ, {"GH_TOKEN": "synthetic-token"}),
            patch.object(audit.urllib.request, "urlopen", return_value=response) as request,
        ):
            self.assertEqual(audit.python_severity({"id": "PYSEC-example", "aliases": ["GHSA-example"]}), "high")
            self.assertEqual(request.call_args.args[0].full_url, "https://api.github.com/advisories/GHSA-example")

    def test_missing_severity_and_network_failure_do_not_pass(self):
        self.assertEqual(audit.python_severity({"id": "PYSEC-example", "aliases": []}), "unknown")
        with (
            patch.dict(audit.os.environ, {"GH_TOKEN": "synthetic-token"}),
            patch.object(audit.urllib.request, "urlopen", side_effect=OSError("network unavailable")),
            self.assertRaises(OSError),
        ):
            audit.python_severity({"id": "GHSA-example"})
