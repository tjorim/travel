from fastapi import FastAPI, HTTPException, status
from sqlalchemy import text

from .database import SessionLocal
from .routers.media import provider_tokens_router
from .routers.media import router as media_router
from .routers.publication import delivery_router as publication_delivery_router
from .routers.publication import router as publication_router
from .routers.stays import router as stays_router
from .routers.trips import public_router
from .routers.trips import router as trips_router

app = FastAPI(
    title="Travel tracker API",
    description="Private-by-default trip and moment tracking API.",
    version="0.1.0",
)
app.include_router(trips_router, prefix="/api/v1")
app.include_router(public_router, prefix="/api/v1")
app.include_router(publication_router, prefix="/api/v1")
app.include_router(publication_delivery_router, prefix="/api/v1")
app.include_router(stays_router, prefix="/api/v1")
app.include_router(media_router, prefix="/api/v1")
app.include_router(provider_tokens_router, prefix="/api/v1")


@app.get("/api/health", tags=["health"])
def health() -> dict[str, str]:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable") from error
    return {"status": "ok"}
