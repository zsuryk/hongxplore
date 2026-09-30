"""FastAPI application — scaffold: GET /health only."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(
    title="Hongxplore API",
    version="0.1.0",
    description="Infinite whiteboard + AI activity agent for students in Hong Kong.",
)
app.state.settings = settings

# Web dev server (Vite) runs on 5173; API on 8000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. Shape is mirrored by docs/examples/agent-response.json."""
    return {"status": "ok"}
