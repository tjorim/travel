"""Record visibility update schema."""

from app.models import Visibility
from app.schemas.base import InputModel


class VisibilityUpdate(InputModel):
    """Set who receives one record: the same choice for every shareable kind."""

    visibility: Visibility
