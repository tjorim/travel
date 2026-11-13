"""The shared base of every MCP tool family: identity, the transaction around one tool call and its audit."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import tempfile
from collections.abc import Callable
from contextlib import contextmanager
from typing import Any, TypeVar

from fastapi import HTTPException
from fastapi.datastructures import Headers, UploadFile
from fastapi.encoders import jsonable_encoder
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_access_token, get_context
from pydantic import Field, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from .. import schemas
from ..config import settings
from ..database import SessionLocal
from ..errors import Refusal
from ..models import McpAuditEvent
from ..storage import ObjectStorage, get_storage

Result = TypeVar("Result")


logger = logging.getLogger("app.mcp_server")


class BinaryUpload(schemas.InputModel):
    """A bounded, explicit binary input for an owner-selected local file."""

    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    data_base64: str = Field(min_length=1, max_length=300_000_000)

    @contextmanager
    def upload_file(self):
        # JSON parsing necessarily retains the encoded input. Decode only aligned
        # chunks so there is no second full-sized binary allocation.
        with tempfile.TemporaryFile("w+b") as payload:
            try:
                for offset in range(0, len(self.data_base64), 1024 * 1024):
                    chunk = self.data_base64[offset : offset + 1024 * 1024]
                    if "=" in chunk and offset + len(chunk) != len(self.data_base64):
                        raise ValueError("Premature base64 padding")
                    payload.write(base64.b64decode(chunk, validate=True))
                    if payload.tell() > settings.media_max_upload_bytes:
                        raise ValueError("Upload exceeds maximum size")
            except (binascii.Error, ValueError) as error:
                raise ValueError("data_base64 must be valid base64 within the upload limit") from error
            payload.seek(0)
            yield UploadFile(filename=self.filename, file=payload, headers=Headers({"content-type": self.content_type}))

    def apply(self, operation):
        with self.upload_file() as upload:
            return operation(upload)


_AUDITED = "_travel_mcp_audited"


# proxy passes an inner tool's report on instead of auditing it again.
_REPORTED = "_travel_mcp_reported"


def _reported(error: ToolError) -> ToolError:
    setattr(error, _REPORTED, True)
    return error


def _request_id() -> str | None:
    """The MCP request id, which correlates a client error, a log line and an audit row."""
    try:
        return str(get_context().request_id)
    except Exception:  # no request context, for example a direct call in a test
        return None


def _validation_fields(error: ValidationError) -> str:
    """Field paths and error types only; pydantic messages echo the rejected input."""
    found = error.errors(include_input=False, include_context=False, include_url=False)
    return ", ".join(f"{'.'.join(str(part) for part in item['loc']) or '<root>'}:{item['type']}" for item in found[:8])


class ResponseValidationError(ToolError):
    """Carry only safe field paths across FastMCP's tool-body error boundary."""

    def __init__(self, error: ValidationError) -> None:
        self.fields = _validation_fields(error)
        super().__init__(f"Validation failed ({self.fields})")


def _detail_text(detail: Any) -> str:
    """A refusal's detail for the caller; a structured one (such as the visitor-change review) is sent as JSON."""
    return json.dumps(detail, ensure_ascii=False, default=str) if isinstance(detail, dict) else str(detail)


def _error_summary(error: BaseException) -> str:
    """A short, payload-free description that is safe to log and to persist in the audit trail."""
    if isinstance(error, HTTPException | Refusal):
        # A structured detail quotes the owner's own address and names: keep only its code.
        detail = error.detail
        if isinstance(detail, dict):
            return str(detail.get("code", "rejected"))[:240]
        return str(error if isinstance(error, Refusal) else detail)[:240]
    # FastMCP wraps an invalid-argument error, whose message echoes the rejected values.
    cause = error if isinstance(error, ValidationError) else error.__cause__
    if isinstance(cause, ValidationError):
        return f"Validation failed ({_validation_fields(cause)})"[:240]
    return str(error)[:240]


def storage() -> ObjectStorage:
    """The object storage a tool writes to; one seam for tests to replace."""
    return get_storage()


class McpTools:
    """What every tool family shares: the owner subject, confirmation, audit and one transaction per call."""

    def __init__(self, factory: sessionmaker[Session] = SessionLocal) -> None:
        self.factory = factory

    def _subject(self) -> str:
        """Resolve only a validated FastMCP/OIDC identity, never a tool argument."""
        try:
            token = get_access_token()
        except Exception:  # stdio has no token context
            token = None
        claims = getattr(token, "claims", {}) if token is not None else {}
        subject = claims.get("sub") if isinstance(claims, dict) else None
        if isinstance(subject, str) and subject:
            return subject
        if settings.environment == "development" and settings.mcp_development_subject:
            return settings.mcp_development_subject
        raise PermissionError("Authentication required: a bearer token with a subject claim is required")

    @staticmethod
    def _confirmation(confirm: bool) -> None:
        if not confirm:
            raise ValueError(
                "Set confirm=true after reviewing the preview or target; this operation changes access or deletes data"
            )

    def _audit(
        self,
        session: Session,
        *,
        subject: str,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        result: str,
        detail: str | None = None,
        request_id: str | None = None,
    ) -> None:
        # Payloads and raw exception traces deliberately never become audit data.
        details = {"error": detail} if detail else {}
        if request_id:
            details["request_id"] = request_id
        session.add(
            McpAuditEvent(
                owner_subject=subject,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                trip_id=trip_id,
                result=result,
                details=details,
            )
        )
        session.commit()

    def _record_audit(
        self,
        *,
        subject: str,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        result: str,
        detail: str | None = None,
        request_id: str | None = None,
    ) -> None:
        """Best effort in a separate transaction; never undo a committed operation.

        Failures log only action, request ID and exception class. No durable
        retry or atomic mutation-plus-invocation-audit guarantee is provided.
        """
        try:
            with self.factory() as session:
                self._audit(
                    session,
                    subject=subject,
                    action=action,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    trip_id=trip_id,
                    result=result,
                    detail=detail,
                    request_id=request_id,
                )
        except Exception as error:
            # Domain handlers may already have committed. An audit outage must
            # not turn a completed operation into a reported tool failure.
            logger.error("MCP audit write failed for %s request_id=%s: %s", action, request_id, type(error).__name__)

    def _audit_unexecuted_rejection(self, tool: str, arguments: dict[str, Any] | None, error: BaseException) -> None:
        """Audit a call refused before its tool body ran, such as invalid arguments.

        Only the tool name and a payload-free summary are kept. Nothing is
        recorded without an authenticated subject.
        """
        try:
            subject = self._subject()
        except PermissionError:
            return
        trip_id = (arguments or {}).get("trip_id")
        self._record_audit(
            subject=subject,
            action=tool,
            resource_type="tool_invocation",
            resource_id=None,
            trip_id=trip_id if isinstance(trip_id, str) and len(trip_id) <= 32 else None,
            result="rejected",
            detail=_error_summary(error),
            request_id=_request_id(),
        )

    def _reject(
        self,
        error: Exception,
        subject: str,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        request_id: str | None,
    ) -> None:
        summary = _error_summary(error)
        logger.warning(
            "MCP tool %s rejected request_id=%s error=%s: %s", action, request_id, type(error).__name__, summary
        )
        self._record_audit(
            subject=subject,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            trip_id=trip_id,
            result="rejected",
            detail=summary,
            request_id=request_id,
        )

    def _call(
        self,
        action: str,
        resource_type: str,
        resource_id: str | None,
        trip_id: str | None,
        operation: Callable[[Session, str], Result],
        output: Callable[[Result], Any] = jsonable_encoder,
        *,
        confirm: bool = True,
        needs_confirmation: bool = False,
        after_commit: Callable[[Result, Session], None] | None = None,
    ) -> Any:
        """Run one tool in one transaction: the operation, then its rendering, then the commit.

        ``after_commit`` is for the object-storage lifecycle (``docs/object-storage.md``): a removal returns the
        objects it marked ``purge_pending`` and this deletes their bytes only now that the mark is committed."""
        subject = self._subject()
        request_id = _request_id()
        try:
            with self.factory() as session:
                if needs_confirmation:
                    self._confirmation(confirm)
                result = operation(session, subject)
                rendered = output(result)
                session.commit()
                if after_commit is not None:
                    after_commit(result, session)
        except (HTTPException, Refusal) as error:
            self._reject(error, subject, action, resource_type, resource_id, trip_id, request_id)
            if isinstance(error, Refusal) and error.detail is None:
                setattr(error, _AUDITED, True)
                raise
            # A structured refusal (such as a review the owner must acknowledge) is sent as JSON text.
            translated = (
                Refusal(_detail_text(error.detail), code=error.code, params=error.params, field=error.field)
                if isinstance(error, Refusal)
                else ValueError(_detail_text(error.detail))
            )
            setattr(translated, _AUDITED, True)
            raise translated from error
        except Exception as error:
            self._reject(error, subject, action, resource_type, resource_id, trip_id, request_id)
            if isinstance(error, ValidationError):
                # FastMCP 4.1 logs and wraps raw tool-body validation errors
                # before our middleware sees them; strip their input here.
                translated = ResponseValidationError(error)
                setattr(translated, _AUDITED, True)
                raise translated from None
            setattr(error, _AUDITED, True)
            raise
        self._record_audit(
            subject=subject,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            trip_id=trip_id,
            result="succeeded",
            request_id=request_id,
        )
        return rendered
