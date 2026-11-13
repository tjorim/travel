"""The owner tools of Travel: one class that combines the tool families.

Every public method is a tool (see ``server.MCP_TOOL_CAPABILITIES``). A family lives in its own module and calls
the services under ``app/services``, which the HTTP routers share.
"""

from .alternatives import AlternativeTools
from .collections import CollectionTools
from .documents import DocumentTools
from .identity import IdentityTools
from .itinerary import ItineraryTools
from .media import MediaTools
from .packing import PackingTools
from .places import PlaceTools
from .sharing import SharingTools
from .tasks import TaskTools
from .trips import TripTools

TOOL_FAMILIES = (
    IdentityTools,
    TripTools,
    ItineraryTools,
    PlaceTools,
    SharingTools,
    CollectionTools,
    MediaTools,
    DocumentTools,
    PackingTools,
    TaskTools,
    AlternativeTools,
)


class TravelMcpBackend(
    IdentityTools,
    TripTools,
    ItineraryTools,
    PlaceTools,
    SharingTools,
    CollectionTools,
    MediaTools,
    DocumentTools,
    PackingTools,
    TaskTools,
    AlternativeTools,
):
    """Task-specific owner tools which share the application's validation rules."""
