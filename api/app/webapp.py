"""One ASGI app that serves the API *and* the built web app (issue #87).

ADR-0006 puts both behind a single public URL, so there is no second origin and
CORS stops being a cross-origin concern. That means this process owns three
things at once, and the interesting work is entirely in the seam between them:

- `/api/*` and `/health` are the API's, registered before the static mount, and
  a path the API does not recognise must still be a **404**, not a document.
- Real files under the build output are served as themselves.
- Anything else a browser asked for as a document is the SPA's history fallback,
  or a hard refresh on `/weekend/plan/abc` would 404.

The fallback is deliberately restricted to `/api/*` and `/health`, and to
requests that *want* a document. Falling back for a missing `/assets/app.js`
would answer a script request with HTML and a 200, which fails confusingly in the
browser instead of loudly here.
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.main import create_app as create_api_app

WEB_DIST_ENV = "WEB_DIST_DIR"
"""Where the built web app lives. Set by the image; defaulted for the container."""

DEFAULT_WEB_DIST = Path("/app/web/dist")
"""The path the Dockerfile builds the web app to."""

_NEVER_FALLBACK = ("/api", "/health")
"""Path prefixes the API owns. A miss here is a 404, never `index.html`."""


def _wants_document(scope: Scope) -> bool:
    """Whether this is a navigation, not an asset fetch.

    Two tests, and both are needed: the `Accept` header rules out programmatic
    fetches, and the absence of a file extension rules out a missing hashed
    asset. Either alone is wrong — a browser asking for `/assets/app.js` sends
    `Accept: text/html` too, and answering that with HTML and a 200 breaks the
    page in a way that is far harder to diagnose than a 404.
    """
    for name, value in scope.get("headers", ()):
        if name == b"accept" and b"text/html" not in value:
            return False
    tail = scope.get("path", "").rsplit("/", 1)[-1]
    return "." not in tail


class SPAStaticFiles(StaticFiles):
    """The built web app, with history fallback for client-side routes."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            if any(scope.get("path", "").startswith(prefix) for prefix in _NEVER_FALLBACK):
                raise
            if scope.get("method") not in ("GET", "HEAD") or not _wants_document(scope):
                raise
            return await super().get_response("index.html", scope)


def create_app(dist_dir: Path | None = None) -> FastAPI:
    """A fresh API app, plus the built web app mounted at `/` when it exists.

    Missing build output is not an error: local development runs Vite on its own
    port and never produces `dist/`, so this module has to stay importable and
    the API has to keep serving on its own.
    """
    app = create_api_app()
    root = dist_dir or Path(os.environ.get(WEB_DIST_ENV, DEFAULT_WEB_DIST))

    if (root / "index.html").is_file():
        # Appended last, so every route the API registered is matched first.
        app.mount("/", SPAStaticFiles(directory=root, html=True), name="web")

    return app


# `uvicorn app.webapp:app` — the single process the container runs.
app = create_app()

__all__ = ["DEFAULT_WEB_DIST", "WEB_DIST_ENV", "create_app"]
