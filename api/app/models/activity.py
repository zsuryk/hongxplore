"""Activity — the canonical domain object and single source of truth for the API contract."""

from decimal import Decimal
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


class Price(ContractModel):
    """What an Activity costs.

    The whole object is **absent** when the source publishes no pricing at all — a
    third state, distinct from both an explicit free entry and a priced one. A
    present price says one of:

    - **free of charge** — ``is_free=True`` with no ``amount``
    - **priced** — an ``amount`` greater than zero, optionally in another currency
    """

    amount: Decimal | None = Field(
        default=None,
        gt=0,
        description="Cost in `currency`, greater than zero; null when `is_free` is true.",
    )
    currency: str = Field(
        default="HKD",
        min_length=1,
        pattern=r"^[A-Z]{3}$",
        description="ISO 4217 code of `amount`; meaningless when `is_free` is true.",
    )
    is_free: bool = Field(
        default=False,
        description="True when the source states the Activity is free of charge.",
    )

    @model_validator(mode="after")
    def _free_and_amount_agree(self) -> Self:
        if self.is_free and self.amount is not None:
            raise ValueError("amount must be null when `is_free` is true")
        if not self.is_free and self.amount is None:
            raise ValueError("a price must carry an amount or `is_free`")
        return self


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
    price: Price | None = Field(
        default=None,
        description=(
            "What it costs; absent when the source publishes no pricing at all, "
            "which is distinct from an explicit free entry."
        ),
    )
    listed_at: UtcDateTime | None = Field(
        default=None,
        description="When the source published or last confirmed this listing (UTC).",
    )
    description: str | None = Field(
        default=None,
        description=(
            "Longer prose about the Activity, in the language given by `lang`; "
            "absent when the source publishes none."
        ),
    )
    description_en: str | None = Field(
        default=None,
        description="English translation of `description`; filled by the agent's translate step.",
    )
