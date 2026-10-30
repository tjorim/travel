"""Audit both lockfiles; keep low/moderate findings visible without blocking CI."""

import datetime
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run_report(command, path, cwd):
    result = subprocess.run(command, cwd=cwd, check=False)
    # Audit tools return 1 for findings; other failures must never become a pass.
    if result.returncode not in (0, 1):
        raise RuntimeError(f"Audit command failed: {command}")
    return json.loads(path.read_text())


def python_severity(vulnerability):
    ids = [vulnerability["id"], *vulnerability.get("aliases", [])]
    ghsa = next((value for value in ids if value.startswith("GHSA-")), None)
    if ghsa is None:
        return "unknown"
    request = urllib.request.Request(
        f"https://api.github.com/advisories/{ghsa}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {os.environ['GH_TOKEN']}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)["severity"]


def evaluate(findings, ignores, today):
    blocked = False
    for finding in findings:
        exception = next((entry for entry in ignores if entry["id"] in finding["ids"]), None)
        ignored = exception is not None and datetime.date.fromisoformat(exception["expires"]) >= today
        severity = finding["severity"]
        print(f"{finding['package']}: {', '.join(finding['ids'])} ({severity})" + (" [ignored]" if ignored else ""))
        if not ignored and severity not in {"low", "moderate", "medium", "info", "none"}:
            blocked = True
    return blocked


def main():
    policy = json.loads((ROOT / ".github/dependency-audit-ignores.json").read_text())
    for entry in policy:
        if not all(entry.get(key) for key in ("id", "reason", "review", "expires")):
            raise ValueError("Audit exceptions require id, reason, review and expires")
        datetime.date.fromisoformat(entry["expires"])
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        requirements = directory / "requirements.txt"
        subprocess.run(
            ["uv", "export", "--frozen", "--all-groups", "--no-emit-project", "--output-file", str(requirements)],
            cwd=ROOT / "backend",
            check=True,
            stdout=subprocess.DEVNULL,
        )
        backend = run_report(
            [
                "uv",
                "tool",
                "run",
                "pip-audit==2.10.1",
                "--require-hashes",
                "--no-deps",
                "--disable-pip",
                "--strict",
                "-r",
                str(requirements),
                "--format",
                "json",
                "--output",
                str(directory / "backend.json"),
            ],
            directory / "backend.json",
            ROOT,
        )
        # pnpm has no output-file flag; retain stdout as the full report.
        result = subprocess.run(["pnpm", "audit", "--json"], cwd=ROOT / "frontend", capture_output=True, text=True)
        if result.returncode not in (0, 1):
            raise RuntimeError(result.stderr or result.stdout)
        frontend = json.loads(result.stdout)
        if "error" in frontend or "advisories" not in frontend:
            raise RuntimeError(f"Invalid pnpm audit response: {frontend}")
        # Preserve raw reports even if severity enrichment fails.
        print(json.dumps({"backend": backend, "frontend": frontend}, indent=2))
        findings = []
        for dependency in backend["dependencies"]:
            if dependency.get("skip_reason"):
                raise RuntimeError(f"Unaudited dependency: {dependency}")
            for vulnerability in dependency["vulns"]:
                findings.append(
                    {
                        "package": dependency["name"],
                        "ids": [vulnerability["id"], *vulnerability.get("aliases", [])],
                        "severity": python_severity(vulnerability),
                    }
                )
        for advisory in frontend["advisories"].values():
            findings.append(
                {
                    "package": advisory["module_name"],
                    "ids": [advisory["github_advisory_id"], *advisory.get("cves", [])],
                    "severity": advisory["severity"],
                }
            )
        blocked = evaluate(findings, policy, datetime.date.today())
        print(f"Dependency audit: {len(findings)} findings; gate {'FAILED' if blocked else 'passed'}")
        return int(blocked)


if __name__ == "__main__":
    sys.exit(main())
