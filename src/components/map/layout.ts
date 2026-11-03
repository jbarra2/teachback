// Turns a course map (PLAN §7) into positioned React Flow nodes and edges, laid out top to bottom
// with dagre: a concept sits below the concepts that lead to it.
import { Graph, layout } from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { CourseMap, MasteryState } from "@/lib/api-client";

export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 72;

export type ConceptNodeData = {
  name: string;
  state: MasteryState;
  /** Practice for this concept. */
  href: string;
};

export type ConceptNode = Node<ConceptNodeData, "concept">;

export function practiceHref(courseId: string, conceptId: string): string {
  return `/courses/${encodeURIComponent(courseId)}/practice?concept=${encodeURIComponent(conceptId)}`;
}

/**
 * Positioned nodes and edges. Edges to unknown concepts, self-loops and duplicates are dropped, so
 * bad data can't break the layout; dagre breaks any cycles itself.
 */
export function layoutMap(
  map: CourseMap,
  courseId: string,
): { nodes: ConceptNode[]; edges: Edge[] } {
  const ids = new Set(map.nodes.map((node) => node.id));
  const seen = new Set<string>();
  const edges: Edge[] = [];
  for (const { from, to } of map.edges) {
    const id = `${from}->${to}`;
    if (from === to || !ids.has(from) || !ids.has(to) || seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, source: from, target: to });
  }

  // dagre reads width and height, and writes the center's x and y.
  const graph = new Graph<
    object,
    { width: number; height: number; x?: number; y?: number }
  >();
  graph.setGraph({ rankdir: "TB", nodesep: 32, ranksep: 64 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of map.nodes)
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  layout(graph);

  const nodes = map.nodes.map((node): ConceptNode => {
    const { x = 0, y = 0 } = graph.node(node.id);
    return {
      id: node.id,
      type: "concept",
      // dagre gives centers; React Flow wants the top-left corner.
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      // A known size counts as measured: React Flow shows and fits the nodes on first paint.
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      data: {
        name: node.name,
        state: node.state,
        href: practiceHref(courseId, node.id),
      },
    };
  });
  return { nodes, edges };
}
