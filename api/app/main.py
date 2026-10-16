"""FastAPI application — GET /health plus the POST /api/agent contract stub."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes.agent import router as agent_router

DESCRIPTION = "Infinite whiteboard + AI activity agent for students in Hong Kong."


def create_app() -> FastAPI:
    """Build a fresh API application.

    A factory rather than a bare module-level object because `app.webapp` mounts
    the built web app onto whatever it is given: mounting onto a shared singleton
    would make the second call double-mount and make every caller see the first
    call's build output. Each caller gets its own app.
    """
    app = FastAPI(
        title="Hongxplore API",
        version="0.1.0",
        description=DESCRIPTION,
    )
    app.state.settings = settings

    # Web dev server (Vite) runs on 5173; API on 8000. A deployed instance serves
    # the web app from this same origin, so it needs no cross-origin allowance.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        """Liveness probe: returns `{"status": "ok"}`.

        Cloud Run calls this unauthenticated on every instance start, so it must
        stay cheap and must describe nothing about the deployment — no version,
        no config, no build id.
        """
        return {"status": "ok"}

    app.include_router(agent_router)
    return app


app = create_app()
