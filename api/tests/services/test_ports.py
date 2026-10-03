"""The service seam drafted in issue #4 must keep its three Protocol interfaces."""

from app.services.ports import ActivityCache, LLMClient, SearchProvider


def test_ports_declare_the_seam_methods() -> None:
    assert callable(getattr(SearchProvider, "search", None))
    assert callable(getattr(LLMClient, "complete", None))
    assert callable(getattr(ActivityCache, "get", None))
    assert callable(getattr(ActivityCache, "set", None))
