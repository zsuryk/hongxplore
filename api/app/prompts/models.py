"""Data models for prompt inputs, structured outputs, and parsing errors."""

from app.models import ContractModel, FreeSlot


class PromptParseError(ValueError):
    """Raised when an LLM completion cannot be parsed into the expected structured model."""


class ParsedIntent(ContractModel):
    """Structured search intent extracted from natural-language query and free-slot chips.

    Conforms to issue #4 canonical contract models and feeds search providers and agent logging.
    """

    query: str
    search_query: str
    categories: list[str] = []
    districts: list[str] = []
    free_only: bool = False
    english_friendly: bool = False
    temporal_expression: str | None = None
    matched_slot_indices: list[int] = []
    target_slots: list[FreeSlot] = []
    summary: str

    def to_log_message(self) -> str:
        """Format as message for AgentLogEntry in AgentResponse.log."""
        return f"Parsed intent: {self.summary}"
