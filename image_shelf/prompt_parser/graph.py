from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator, Mapping
from typing import Any

from .models import Connection, InputValue, Node


class WorkflowGraph:
    def __init__(self, nodes: Mapping[str, Node]) -> None:
        self._nodes = dict(nodes)
        self._consumers: dict[tuple[str, int], list[tuple[str, str]]] = defaultdict(
            list
        )
        for node in self._nodes.values():
            for input_value in node.inputs.values():
                connection = input_value.connection
                if connection is not None:
                    self._consumers[
                        (connection.node_id, connection.output_index)
                    ].append((node.id, input_value.name))

    @classmethod
    def from_api_workflow(cls, workflow: Mapping[str, Any]) -> WorkflowGraph:
        nodes: dict[str, Node] = {}
        for raw_id, raw_node in workflow.items():
            if not isinstance(raw_node, Mapping):
                continue
            class_type = raw_node.get("class_type")
            raw_inputs = raw_node.get("inputs", {})
            if not isinstance(class_type, str):
                continue
            if not isinstance(raw_inputs, Mapping):
                raw_inputs = {}
            inputs: dict[str, InputValue] = {}
            for raw_name, value in raw_inputs.items():
                name = str(raw_name)
                connection = cls._parse_connection(value)
                inputs[name] = InputValue(name, connection if connection else value)
            node_id = str(raw_id)
            nodes[node_id] = Node(node_id, class_type, inputs)
        return cls(nodes)

    @staticmethod
    def _parse_connection(value: Any) -> Connection | None:
        if (
            isinstance(value, (list, tuple))
            and len(value) == 2
            and isinstance(value[0], (str, int))
            and isinstance(value[1], int)
            and not isinstance(value[1], bool)
        ):
            return Connection(str(value[0]), value[1])
        return None

    def nodes(self) -> Iterator[Node]:
        yield from self._nodes.values()

    def get_node(self, node_id: str) -> Node | None:
        return self._nodes.get(str(node_id))

    def require_node(self, node_id: str) -> Node:
        node = self.get_node(node_id)
        if node is None:
            raise KeyError(f"Unknown workflow node: {node_id}")
        return node

    def get_input(self, node_id: str, input_name: str) -> InputValue | None:
        node = self.get_node(node_id)
        return node.inputs.get(input_name) if node else None

    def get_input_source(self, node_id: str, input_name: str) -> Connection | None:
        input_value = self.get_input(node_id, input_name)
        return input_value.connection if input_value else None

    def get_output_consumers(
        self, node_id: str, output_index: int
    ) -> list[tuple[str, str]]:
        return list(self._consumers.get((str(node_id), output_index), ()))

    def iter_input_sources(self, node: Node) -> Iterator[tuple[str, Connection]]:
        for input_value in node.inputs.values():
            connection = input_value.connection
            if connection is not None:
                yield input_value.name, connection

    def source_node(self, node_id: str, input_name: str) -> Node | None:
        connection = self.get_input_source(node_id, input_name)
        return self.get_node(connection.node_id) if connection else None
