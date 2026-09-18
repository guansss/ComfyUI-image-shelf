import time
from contextlib import contextmanager


class Timings:
    def __init__(self) -> None:
        self.durations: dict[str, float] = {}
        self.counts: dict[str, int] = {}
        self.start_time = time.perf_counter()

    @contextmanager
    def measure(self, operation: str):
        start_time = time.perf_counter()
        try:
            yield
        finally:
            self.add(operation, time.perf_counter() - start_time)

    def finish(self) -> None:
        self.add("total", time.perf_counter() - self.start_time)

    def add(self, operation: str, duration: float, count: int = 1) -> None:
        self.durations[operation] = self.durations.get(operation, 0.0) + duration
        self.counts[operation] = self.counts.get(operation, 0) + count

    def merge(self, prefix: str | None, timings: "Timings") -> None:
        for operation, duration in timings.durations.items():
            operation_name = f"{prefix}.{operation}" if prefix else operation
            self.add(operation_name, duration, timings.counts.get(operation, 0))

    def format(self) -> str:
        return ", ".join(
            f"{operation}={self.durations[operation] * 1000:.2f}ms/{self.counts[operation]}"
            for operation in self.durations
        )
