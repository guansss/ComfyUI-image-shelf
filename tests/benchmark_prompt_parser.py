from __future__ import annotations

import argparse
import statistics
import timeit
from collections.abc import Callable
from typing import Any

from image_shelf.prompt_parser import parse_workflow


def _shared_chain_workflow(length: int, endpoint_count: int) -> dict[str, Any]:
    workflow: dict[str, Any] = {
        "0": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "benchmark prompt"},
        }
    }
    for node_id in range(1, length):
        workflow[str(node_id)] = {
            "class_type": "PassThrough",
            "inputs": {"input": [str(node_id - 1), 0]},
        }
    for endpoint_id in range(length, length + endpoint_count):
        workflow[str(endpoint_id)] = {
            "class_type": "KSampler",
            "inputs": {"positive": [str(length - 1), 0]},
        }
    return workflow


def _branching_workflow(branch_count: int, branch_length: int) -> dict[str, Any]:
    workflow: dict[str, Any] = {}
    node_id = 0

    for branch in range(branch_count):
        source_id = str(node_id)
        workflow[source_id] = {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": f"branch {branch}"},
        }
        node_id += 1
        previous_id = source_id
        for _ in range(branch_length):
            current_id = str(node_id)
            workflow[current_id] = {
                "class_type": "PassThrough",
                "inputs": {"input": [previous_id, 0]},
            }
            previous_id = current_id
            node_id += 1
        workflow[str(node_id)] = {
            "class_type": "KSampler",
            "inputs": {"positive": [previous_id, 0]},
        }
        node_id += 1
    return workflow


def _benchmark(
    name: str,
    workflow_factory: Callable[[], dict[str, Any]],
    repetitions: int,
) -> None:
    workflow = workflow_factory()
    result = parse_workflow(workflow)
    if not result.matches:
        raise AssertionError(f"{name} produced no matches")

    timings = timeit.repeat(
        lambda: parse_workflow(workflow),
        repeat=5,
        number=repetitions,
    )
    median_ms = statistics.median(timings) * 1000 / repetitions
    print(
        f"{name}: {len(workflow)} nodes, {len(result.matches)} matches, "
        f"median {median_ms:.3f} ms/parse"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repetitions", type=int, default=10)
    args = parser.parse_args()

    _benchmark(
        "shared-chain",
        lambda: _shared_chain_workflow(length=80, endpoint_count=20),
        args.repetitions,
    )
    _benchmark(
        "branching",
        lambda: _branching_workflow(branch_count=20, branch_length=20),
        args.repetitions,
    )


if __name__ == "__main__":
    main()
