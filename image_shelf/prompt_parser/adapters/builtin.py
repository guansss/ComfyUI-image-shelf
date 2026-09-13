from __future__ import annotations

from . import AdapterRegistry


def builtin_adapters() -> AdapterRegistry:
    return AdapterRegistry()


CONDITIONING_SINKS: dict[tuple[str, str], str] = {
    ("KSampler", "positive"): "positive",
    ("KSampler", "negative"): "negative",
}
