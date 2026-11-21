"""``python -m app.media.worker``: the supervised dispatcher in docs/media-worker.md, kept at this path.

The code lives in ``app.services.media.worker``; this entrypoint only runs it, so service units written for the old
path keep working. Remove it (and this package) once the units have moved to ``python -m app.services.media.worker``."""

import runpy

if __name__ == "__main__":
    runpy.run_module("app.services.media.worker", run_name="__main__")
