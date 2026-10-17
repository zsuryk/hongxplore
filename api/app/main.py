"""FastAPI application — GET /health plus the POST /api/agent contract stub."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings
from app.config import settings as default_settings
from app.hardening import MaxRequestBytes, RateLimiter, install_secret_redaction
from app.routes.agent import router as agent_router

DESCRIPTION = "Infinite whiteboard + AI activity agent for students in Hong Kong."

# The live-mode request shape: a JSON POST. Named explicitly rather than "*",
# so a future header has to be a decision instead of an accident.
ALLOWED_METHODS = ["GET", "POST", "OPTIONS"]
ALLOWED_HEADERS = ["content-type"]
"""`content-type: application/json` is what makes a live request need a preflight."""


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build a fresh API application.

    A factory rather than a bare module-level object because `app.webapp` mounts
    the built web app onto whatever it is given: mounting onto a shared singleton
    would make the second call double-mount and make every caller see the first
    call's build output. Each caller gets its own app — which is also what lets a
    test build an app with its own limits and its own rate-limit ledger.

    `settings` is an override for tests and for an embedder that has already
    built its own; production takes the process-wide instance.
    """
    resolved = settings or default_settings

    app = FastAPI(
        title="Hongxplore API",
        version="0.1.0",
        description=DESCRIPTION,
    )
    app.state.settings = resolved
    # One ledger per app, on the app rather than in a module global, so a second
    # app in the same process (every test) does not share the first one's counts.
    app.state.rate_limiter = RateLimiter()

    install_secret_redaction(resolved)

    # Added first, so CORS ends up outermost: Starlette runs the most recently
    # added middleware first, and a body that is refused as too large is exactly
    # the response a cross-origin client most needs to be able to read. With the
    # order reversed, the 413 carries no `Access-Control-Allow-Origin` and the
    # dev or preview client can only see an opaque network error.
    app.add_middleware(MaxRequestBytes, max_bytes=resolved.max_request_bytes)

    # A deployed instance serves the web app from this same origin, so it needs
    # no cross-origin allowance at all; the list is explicit origins only and a
    # wildcard is refused at startup. Credentials stay off: nothing here uses a
    # cookie, and the access key travels in a JSON body, which is not credential
    # mode. The Vite dev origin is what local development needs.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved.cors_allowed_origins,
        allow_credentials=False,
        allow_methods=ALLOWED_METHODS,
        allow_headers=ALLOWED_HEADERS,
        max_age=resolved.cors_preflight_max_age_seconds,
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        """Liveness probe: returns `{"status": "ok"}`.

        Cloud Run calls this unauthenticated on every instance start, so it must
        stay cheap and must describe nothing about the deployment — no version,
        no config, no build id. It is also the keep-warm ping's target, which is
        why it must not spend the agent endpoint's rate limit: the ping every five
        minutes would otherwise evict the judge's own queries.
        """
        return {"status": "ok"}

    app.include_router(agent_router)
    return app


app = create_app()
