"""Activity — the canonical domain object and single source of truth for the API contract."""

from typing import Literal, Self

from pydantic import Field, HttpUrl, model_validator

from app.models.base import ContractModel, UtcDateTime

Lang = Literal["zh", "en"]
"""Language of an Activity's own text. ``zh`` is the Cantonese / Traditional Chinese original."""


class TimeRange(ContractModel):
    """A UTC instant pair; every time in the contract is stored UTC and displayed HKT."""

    start: UtcDateTime
    end: UtcDateTime

    @model_validator(mode="after")
    def _end_must_follow_start(self) -> Self:
        if self.end <= self.start:
            raise ValueError("end must be after start")
        return self


class ActivityPart(TimeRange):
    """One bookable or attendable time slot of an Activity — what ``Activity.parts`` holds."""


class FreeSlot(TimeRange):
    """A period the user marked as available — the glossary's **free slot**."""


class Source(ContractModel):
    """Where an Activity was found — attribution for seed data and search results."""

    name: str
    url: HttpUrl | None = None


class Location(ContractModel):
    """Where an Activity happens. ``district`` drives district-filtered search."""

    district: str
    venue: str | None = None
    address: str | None = None


class Activity(ContractModel):
    """A real-world thing a student can attend or book in Hong Kong."""

    id: str = Field(description="Stable identifier, unique across seed data and search results.")
    title: str = Field(description="Title in the Activity's own language, given by `lang`.")
    title_en: str | None = Field(
        default=None,
        description="English translation of `title`; filled by the agent's translate step.",
    )
    lang: Lang = Field(description="Language of `title`.")
    tags: list[str] = Field(description="Tags used for search, ranking and filtering.")
    parts: list[ActivityPart] = Field(
        description="Time slots the Activity runs; empty when the source publishes no schedule."
    )
    source: Source = Field(description="Where this Activity came from.")
    location: Location = Field(description="District, venue and address.")
    url: HttpUrl = Field(description="The Activity's own page — details or booking.")
    image: HttpUrl | None = None
