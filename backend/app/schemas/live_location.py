"""Live location session, position and track schemas."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from app.schemas.base import InputModel, ResponseModel, SafeText

LivePrecisionName = Literal["exact", "1km", "10km"]


LiveDelaySeconds = Literal[0, 900, 1800, 3600, 7200, 86400]


LIVE_AUDIENCE_KEY = (
    "`public` for the public view, or the id of one of the trip's share links. A link that is revoked, expired or "
    "rotated loses its setting."
)


class CurrentLocation(BaseModel):
    delay_seconds: int
    expires_at: datetime
    latitude: float
    longitude: float
    observed_at: datetime
    stale: bool
    precision: LivePrecisionName


class LiveSessionCreate(InputModel):
    model_config = ConfigDict(strict=True)

    source: Annotated[SafeText, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")] = Field(
        description="An opaque name the owner gives the position source, such as a Home Assistant entity id. "
        "Letters, digits, `.`, `_`, `:` and `-`, starting with a letter or digit; Travel never interprets it."
    )


class LiveSessionConfigure(InputModel):
    model_config = ConfigDict(strict=True)

    enabled: bool
    audiences: dict[Annotated[SafeText, Field(min_length=1, max_length=32)], LivePrecisionName] = Field(
        default_factory=dict,
        max_length=100,
        description="The audiences that receive the current position, with the precision each receives, keyed by "
        + LIVE_AUDIENCE_KEY
        + " It replaces the saved audiences: one left out is removed together with its delay.",
    )
    delays: dict[Annotated[SafeText, Field(min_length=1, max_length=32)], LiveDelaySeconds] | None = Field(
        default=None,
        max_length=100,
        description="Seconds to hold the position back, per audience in `audiences`. Only the audiences named here "
        "change; one that has no saved delay starts at 0. Omit it to keep every saved delay.",
    )


class LivePositionInput(InputModel):
    observed_at: AwareDatetime
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False, strict=True)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False, strict=True)


class LivePointResponse(ResponseModel):
    id: str
    observed_at: AwareDatetime
    latitude: float
    longitude: float


class LiveSessionResponse(ResponseModel):
    id: str
    source: str
    enabled: bool
    audiences: dict[str, LivePrecisionName] = Field(
        description="The precision each audience receives, keyed by " + LIVE_AUDIENCE_KEY
    )
    delays: dict[str, int] = Field(description="The delay of each audience in `audiences`, in seconds.")
    previews: dict[str, list[CurrentLocation]] = Field(
        description="What each enabled audience receives right now, at its delivered precision and delay."
    )
    current: LivePointResponse | None
    stale: bool = Field(description="The newest point is more than an hour old.")
    created_at: AwareDatetime
    updated_at: AwareDatetime


class LivePositionAccepted(ResponseModel):
    accepted: bool = Field(description="False when the same position was already stored (a retry).")


class LiveTrackPage(ResponseModel):
    points: list[LivePointResponse]
    next: str | None = Field(description="Pass as `after` for the next page; null on the last one.")
