"""Preparation tasks and their alerts."""

from __future__ import annotations

from typing import Any

from .. import schemas
from ..services import tasks as task_service
from .core import McpTools
from .rendering import _model, _models


class TaskTools(McpTools):
    """Preparation tasks and their alerts."""

    def list_trip_tasks(self, trip_id: schemas.Identifier) -> list[dict[str, Any]]:
        """List owner preparation tasks with their due dates and reminders."""
        return self._call(
            "trip_task.list",
            "trip_task",
            None,
            trip_id,
            lambda s, sub: task_service.list_trip_tasks(s, sub, trip_id),
            lambda x: _models(x, schemas.TripTaskResponse),
        )

    def create_trip_task(self, trip_id: schemas.Identifier, payload: schemas.TripTaskCreate) -> dict[str, Any]:
        """Create a private task. Use remind_at for an inbox and email reminder; due_date alone schedules nothing."""
        return self._call(
            "trip_task.create",
            "trip_task",
            None,
            trip_id,
            lambda s, sub: task_service.create_trip_task(s, sub, trip_id, payload),
            lambda x: _model(x, schemas.TripTaskResponse),
        )

    def update_trip_task(
        self, trip_id: schemas.Identifier, task_id: schemas.Identifier, payload: schemas.TripTaskUpdate
    ) -> dict[str, Any]:
        """Update a private task, including its explicit reminder schedule."""
        return self._call(
            "trip_task.update",
            "trip_task",
            task_id,
            trip_id,
            lambda s, sub: task_service.update_trip_task(s, sub, trip_id, task_id, payload),
            lambda x: _model(x, schemas.TripTaskResponse),
        )

    def delete_trip_task(
        self, trip_id: schemas.Identifier, task_id: schemas.Identifier, confirm: bool = False
    ) -> dict[str, str]:
        """Delete a preparation task after explicit confirmation."""
        return self._call(
            "trip_task.delete",
            "trip_task",
            task_id,
            trip_id,
            lambda s, sub: task_service.delete_trip_task(s, sub, trip_id, task_id),
            lambda _: {"status": "deleted"},
            confirm=confirm,
            needs_confirmation=True,
        )

    def list_task_alerts(self, trip_id: schemas.Identifier) -> list[dict[str, Any]]:
        """List delivered owner-inbox reminders for a trip's tasks that are due."""
        return self._call(
            "task_alert.list",
            "task_alert",
            None,
            trip_id,
            lambda s, sub: task_service.list_task_alerts(s, sub, trip_id),
            lambda x: _models(x, schemas.TripTaskAlertResponse),
        )

    def mark_task_alert_read(self, trip_id: schemas.Identifier, alert_id: schemas.Identifier) -> dict[str, Any]:
        """Mark one owner-inbox task alert as read."""
        return self._call(
            "task_alert.read",
            "task_alert",
            alert_id,
            trip_id,
            lambda s, sub: task_service.mark_task_alert_read(s, sub, trip_id, alert_id),
            lambda x: _model(x, schemas.TripTaskAlertResponse),
        )

    def get_trip_task(self, trip_id: schemas.Identifier, task_id: schemas.Identifier) -> dict[str, Any]:
        """Read one owner preparation task."""
        return self._call(
            "trip_task.get",
            "trip_task",
            task_id,
            trip_id,
            lambda s, sub: task_service.get_trip_task(s, sub, trip_id, task_id),
            lambda x: _model(x, schemas.TripTaskResponse),
        )
