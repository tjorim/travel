"""Log setup shared with the other apps: ``asctime - logger - level - message``, the message a one-line JSON object."""

import logging

LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
ACCESS_LOGGER = "travel.access"


def configure_logging() -> None:
    """Give the access log a handler when nothing else would print it (uvicorn configures only its own loggers).

    The root logger is left alone, so third-party loggers keep their own levels; a deployment that configures the
    root logger itself keeps the single stream.
    """
    access = logging.getLogger(ACCESS_LOGGER)
    access.setLevel(logging.INFO)
    if access.handlers or logging.getLogger().handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    access.addHandler(handler)
