"""Safe exceptions: never retain bodies, tokens, URLs or original exceptions."""


class TravelError(Exception):
    def __init__(self, code: str, *, status: int | None = None, ambiguous: bool = False):
        super().__init__(code)
        self.code = code
        self.status = status
        self.ambiguous = ambiguous


class AuthenticationError(TravelError):
    """Refresh or interactive reauthentication is required; request was not retried."""


class TransportError(TravelError):
    """A write may have committed. Reconcile by reading before another attempt."""


class ProtocolError(TravelError):
    """The response did not match the bounded JSON contract."""


class RateLimitError(TravelError):
    def __init__(self, retry_after: float | None):
        super().__init__("rate_limited", status=429)
        self.retry_after = retry_after
