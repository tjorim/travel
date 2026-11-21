"""``python -m app.task_alerts``: the VPS scheduler command in backend/README.md, kept at this path.

The code lives in ``app.services.task_alerts``; this entrypoint only runs it, so scheduler units written for the old
path keep working. Remove it once the units have moved to ``python -m app.services.task_alerts``."""

import runpy

if __name__ == "__main__":
    runpy.run_module("app.services.task_alerts", run_name="__main__")
