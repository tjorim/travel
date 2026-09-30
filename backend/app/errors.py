"""Language-neutral HTTP errors. Diagnostic detail is never a UI translation key."""

from typing import Any

from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic_core import PydanticCustomError
from starlette.exceptions import HTTPException as StarletteHTTPException


class ServiceError(ValueError):
    """A safe diagnostic with an explicit machine-readable cause."""

    def __init__(self, message: str, *, code: str = "operation_failed", params: dict | None = None):
        super().__init__(message)
        self.code = code
        self.params = params or {}


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
    return ApiException(
        status_code,
        str(error) if isinstance(error, ServiceError) else "Invalid request",
        code=error.code if isinstance(error, ServiceError) else "invalid_input",
        params=error.params if isinstance(error, ServiceError) else {},
    )


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
