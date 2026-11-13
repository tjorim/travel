"""Language-neutral HTTP errors. Diagnostic detail is never a UI translation key."""

from typing import Any, ClassVar

from fastapi import HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic_core import PydanticCustomError
from starlette.exceptions import HTTPException as StarletteHTTPException


class ServiceError(ValueError):
    """A safe diagnostic with an explicit machine-readable cause."""

    def __init__(
        self, message: str, *, code: str = "operation_failed", params: dict | None = None, field: str | None = None
    ):
        super().__init__(message)
        self.code = code
        self.params = params or {}
        self.field = field


class Refusal(ServiceError):
    """A request a service refuses because of what the caller sent or may see.

    Services raise it and know nothing of HTTP: the application answers it with ``status_code`` and a body that
    carries ``code`` (see ``service_error_handler``), and the MCP adapter reports its message, so one refusal has
    one code on both transports. Any other ``ServiceError`` is an invariant or a lower layer's failure, never the
    caller's to fix, and stays unanswered (a 500) unless the caller wraps it."""

    status_code: ClassVar[int] = status.HTTP_422_UNPROCESSABLE_CONTENT

    def __init__(
        self,
        message: str,
        *,
        code: str = "operation_failed",
        params: dict | None = None,
        field: str | None = None,
        detail: Any = None,
    ):
        super().__init__(message, code=code, params=params, field=field)
        # A structured body (a review the owner must acknowledge) that replaces the message as the response's
        # ``detail``; HTTP sends it as JSON and the MCP adapter sends it as JSON text.
        self.detail = detail


class Conflict(Refusal):
    """A request that clashes with the current state, or needs the owner's acknowledgement first."""

    status_code = status.HTTP_409_CONFLICT


class RecordNotFound(Refusal):
    """A record that does not exist, or is not the caller's to see."""

    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, message: str, *, code: str = "not_found", params: dict | None = None):
        super().__init__(message, code=code, params=params)


class BadGateway(Refusal):
    """A provider outside Travel failed (HTTP 502)."""

    status_code = status.HTTP_502_BAD_GATEWAY


class InvalidRevision(Refusal):
    """An ``If-Match`` that is not a revision this API issued (HTTP 400)."""

    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self) -> None:
        super().__init__("Invalid revision", code="invalid_revision")


class RevisionConflict(Refusal):
    """A write that lost its revision race (HTTP 412); ``detail`` carries the winner's current record."""

    status_code = status.HTTP_412_PRECONDITION_FAILED

    def __init__(self, current: Any) -> None:
        code = "scope_revision_conflict"
        super().__init__("The record changed since it was read", code=code, detail={"code": code, "current": current})


class ApiException(HTTPException):
    def __init__(
        self,
        status_code: int,
        detail: Any = None,
        headers: dict | None = None,
        *,
        code: str,
        params: dict | None = None,
        field: str | None = None,
    ):
        super().__init__(status_code, detail, headers)
        self.descriptor = {"code": code, "params": params or {}, "path": ["body", field] if field else []}


def service_exception(status_code: int, error: Exception) -> ApiException:
    if isinstance(error, PydanticCustomError):
        return ApiException(status_code, str(error), code=error.type, params=error.context)
    structured = error.detail if isinstance(error, Refusal) else None
    return ApiException(
        status_code,
        structured if structured is not None else str(error) if isinstance(error, ServiceError) else "Invalid request",
        code=error.code if isinstance(error, ServiceError) else "invalid_input",
        params=error.params if isinstance(error, ServiceError) else {},
        field=error.field if isinstance(error, ServiceError) else None,
    )


def service_error(error: ValueError) -> Refusal:
    """A rule function's failure (a ``ServiceError`` or a validator's ``PydanticCustomError``) as a ``Refusal``."""
    if isinstance(error, Refusal):
        return error
    if isinstance(error, PydanticCustomError):
        return Refusal(str(error), code=error.type, params=error.context)
    if isinstance(error, ServiceError):
        return Refusal(str(error), code=error.code, params=error.params, field=error.field)
    return Refusal("Invalid request", code="invalid_input")


async def service_error_handler(request, error: Refusal) -> JSONResponse:
    """The response for a failure a service raised: its own status, message and machine-readable code."""
    return await http_error_handler(request, service_exception(error.status_code, error))


async def http_error_handler(_request, error: StarletteHTTPException) -> JSONResponse:
    descriptor = getattr(error, "descriptor", {"code": "http_error", "params": {}, "path": []})
    return JSONResponse(
        {"detail": error.detail, "errors": [descriptor]}, status_code=error.status_code, headers=error.headers
    )


# Only numeric constraints are safe to echo. Patterns, enum values, error objects,
# submitted inputs and URLs must never be serialized into a validation response.
_CONSTRAINTS = {"min_length", "max_length", "ge", "le", "gt", "lt", "multiple_of", "max_digits", "decimal_places"}


async def validation_error_handler(_request, error: RequestValidationError) -> JSONResponse:
    details, descriptors = [], []
    for issue in error.errors():
        code = issue["type"]
        params = {
            key: value
            for key, value in issue.get("ctx", {}).items()
            if key in _CONSTRAINTS and type(value) in (int, float)
        }
        path = list(issue.get("loc", ()))
        # JSON decoding errors may embed input fragments in their diagnostic.
        message = issue["msg"] if code != "json_invalid" else "Invalid JSON"
        details.append({"type": code, "loc": path, "msg": message})
        descriptors.append({"code": code, "params": params, "path": path})
    return JSONResponse({"detail": details, "errors": descriptors}, status_code=422)
