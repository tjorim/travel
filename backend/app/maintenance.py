"""``python -m app.maintenance``: the operator command in docs/object-storage.md, kept at this path.

The code lives in ``app.services.maintenance``; this entrypoint only runs it, so scheduler units written for the old
path keep working. Remove it once the units have moved to ``python -m app.services.maintenance``."""

import runpy

if __name__ == "__main__":
    runpy.run_module("app.services.maintenance", run_name="__main__")
