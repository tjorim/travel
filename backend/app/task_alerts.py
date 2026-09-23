"""Idempotent owner-only reminders for explicit trip-task schedules.

Run ``python -m app.task_alerts`` from a VPS scheduler. This module handles
generic reminders only; travelers check availability and make bookings.
"""

import re
import smtplib
import ssl
from collections.abc import Callable
from datetime import UTC, datetime
from email.message import EmailMessage

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .database import SessionLocal
from .models import Trip, TripTask, TripTaskAlert


def process_due_task_alerts(session: Session, now: datetime | None = None) -> int:
    """Create one private inbox item for each due, incomplete reminder."""
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("now must include a timezone")
    count = 0
    tasks = session.scalars(
        select(TripTask).where(
            TripTask.completed_at.is_(None),
            TripTask.remind_at.is_not(None),
            TripTask.reminded_at.is_(None),
        ).with_for_update(skip_locked=True)
    ).all()
    for task in tasks:
        owner = session.scalar(select(Trip.owner_subject).where(Trip.id == task.trip_id))
        if owner is None or task.remind_at is None:
            continue
        reminder = task.remind_at if task.remind_at.tzinfo else task.remind_at.replace(tzinfo=UTC)
        if reminder <= now:
            existing = session.scalar(select(TripTaskAlert.id).where(
                TripTaskAlert.task_id == task.id, TripTaskAlert.kind == "reminder",
                TripTaskAlert.scheduled_for == reminder,
            ))
            if existing is None:
                session.add(TripTaskAlert(
                    task_id=task.id, owner_subject=owner, kind="reminder",
                    title=task.title, scheduled_for=reminder,
                ))
                count += 1
            task.reminded_at = now
    session.commit()
    return count


def _smtp_send(recipient: str, subject: str, body: str) -> None:
    if not settings.task_alert_smtp_host or not settings.task_alert_email_from:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["From"] = settings.task_alert_email_from
    message["To"] = recipient
    message["Subject"] = " ".join(subject.splitlines())
    message.set_content(body)
    with smtplib.SMTP(settings.task_alert_smtp_host, settings.task_alert_smtp_port, timeout=15) as connection:
        connection.starttls(context=ssl.create_default_context())
        if settings.task_alert_smtp_username:
            connection.login(settings.task_alert_smtp_username, settings.task_alert_smtp_password or "")
        connection.send_message(message)


def deliver_pending_alert_emails(
    session: Session, send: Callable[[str, str, str], None] = _smtp_send,
    now: datetime | None = None,
) -> int:
    """Deliver inbox reminders to configured owner addresses with bounded retries.

    SMTP delivery is at least once: a successful send followed by a database
    failure can result in a duplicate on retry.
    """
    now = now or datetime.now(UTC)
    if not settings.task_alert_smtp_host or not settings.task_alert_email_from:
        return 0
    delivered = 0
    seen: set[str] = set()
    while True:
        alert = session.scalar(select(TripTaskAlert).where(
            TripTaskAlert.email_sent_at.is_(None), TripTaskAlert.email_attempts < 5,
            TripTaskAlert.id.not_in(seen),
        ).order_by(TripTaskAlert.created_at, TripTaskAlert.id).limit(1).with_for_update(skip_locked=True))
        if alert is None:
            break
        seen.add(alert.id)
        recipient = settings.task_alert_recipients.get(alert.owner_subject)
        if not recipient:
            continue
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
            alert.email_attempts += 1
            alert.email_last_error = "InvalidRecipient"
            continue
        try:
            send(recipient, f"Travel: {alert.title}", alert.title)
        except Exception as error:
            alert.email_attempts += 1
            alert.email_last_error = type(error).__name__
        else:
            alert.email_sent_at = now
            alert.email_last_error = None
            delivered += 1
        session.commit()
    session.commit()
    return delivered


if __name__ == "__main__":
    with SessionLocal() as alert_session:
        created = process_due_task_alerts(alert_session)
        sent = deliver_pending_alert_emails(alert_session)
        print(f"created={created} emailed={sent}")
