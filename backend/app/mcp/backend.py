"""The owner tools of Travel: one class that combines the tool families.

Every public method is a tool (see ``server.MCP_TOOL_CAPABILITIES``). A family lives in its own module and calls
the services under ``app/services``, which the HTTP routers share.
"""

from app.mcp.alternatives import AlternativeTools
from app.mcp.collections import CollectionTools
from app.mcp.documents import DocumentTools
from app.mcp.identity import IdentityTools
from app.mcp.itinerary import ItineraryTools
from app.mcp.media import MediaTools
from app.mcp.packing import PackingTools
from app.mcp.places import PlaceTools
from app.mcp.sharing import SharingTools
from app.mcp.tasks import TaskTools
from app.mcp.trips import TripTools

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
