import type { LGraph, Subgraph } from "@comfyorg/comfyui-frontend-types"

import { LGraphNode, SubgraphNode } from "../comfy-shims"

/**
 * Executes a side-effect function on all nodes in a graph hierarchy.
 * This is for operations that modify nodes or perform side effects.
 *
 * @param graph - The root graph to traverse
 * @param fn - Function to execute on each node
 */
export function forEachNode(graph: LGraph | Subgraph, fn: (node: LGraphNode) => void): void {
  visitGraphNodes(graph, (node) => {
    // Recursively process subgraphs first
    if (isSubgraphNode(node)) {
      forEachNode(node.subgraph, fn)
    }

    // Execute function on current node
    fn(node)
  })
}

/**
 * Visits each node in a graph (non-recursive, single level).
 *
 * @param graph - The graph to visit nodes from
 * @param visitor - Function called for each node
 */
export function visitGraphNodes(
  graph: LGraph | Subgraph,
  visitor: (node: LGraphNode) => void,
): void {
  for (const node of graph.nodes) {
    visitor(node as LGraphNode)
  }
}

type RuntimeGraphNode = Omit<LGraphNode, "isSubgraphNode"> &
  Partial<Pick<LGraphNode, "isSubgraphNode">>

function isSubgraphNode(node: RuntimeGraphNode): node is SubgraphNode {
  return node.isSubgraphNode?.call(node) ?? false
}
