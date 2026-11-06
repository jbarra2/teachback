import { describe, expect, it } from "vitest";
import type { CourseMap, MasteryState } from "@/lib/api-client";
import { courseMap, CONCEPT_IDS, COURSE_ID } from "@/lib/mocks/fixtures";
import { layoutMap, NODE_HEIGHT, NODE_WIDTH, practiceHref } from "./layout";

const STATES: MasteryState[] = ["MASTERED", "REVIEW", "PRACTICE"];

/** n concepts with cuid-looking ids, each leading to the next `fanOut` ones. */
function bigMap(n: number, fanOut = 2): CourseMap {
  const id = (i: number) => `cconcept${String(i).padStart(16, "0")}`;
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: id(i),
    name: `Concept ${i}`,
    state: STATES[i % 3]!,
    score: (i % 10) / 10,
  }));
  const edges = nodes.flatMap((_, i) =>
    Array.from({ length: fanOut }, (_, k) => i * fanOut + k + 1)
      .filter((j) => j < n)
      .map((j) => ({ from: id(i), to: id(j) })),
  );
  return { nodes, edges };
}

function overlaps(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return Math.abs(a.x - b.x) < NODE_WIDTH && Math.abs(a.y - b.y) < NODE_HEIGHT;
}

describe("layoutMap", () => {
  it("returns nothing for an empty map", () => {
    expect(layoutMap({ nodes: [], edges: [] }, COURSE_ID)).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("carries each concept's name, state and practice link", () => {
    const { nodes } = layoutMap(courseMap, COURSE_ID);
    expect(nodes).toHaveLength(courseMap.nodes.length);
    const osmosis = nodes.find((node) => node.id === CONCEPT_IDS.osmosis);
    expect(osmosis).toMatchObject({
      type: "concept",
      data: {
        name: "Osmosis",
        state: "PRACTICE",
        href: `/courses/${COURSE_ID}/practice?concept=${CONCEPT_IDS.osmosis}`,
      },
    });
  });

  it("keeps every node clickable, overriding React Flow's read-only pointer-events: none", () => {
    const { nodes } = layoutMap(courseMap, COURSE_ID);
    for (const node of nodes)
      expect(node.style).toMatchObject({ pointerEvents: "all" });
  });

  // React Flow reads this as the edge's aria-label. Edges need measured handles, which jsdom
  // can't give, so the component tests can't see them; this checks the label at the source.
  it("labels each edge with its concepts' names for screen readers", () => {
    const { edges } = layoutMap(courseMap, COURSE_ID);
    expect(
      edges.find(
        (edge) =>
          edge.source === CONCEPT_IDS.membrane &&
          edge.target === CONCEPT_IDS.osmosis,
      ),
    ).toMatchObject({ ariaLabel: "Cell membrane leads to Osmosis" });
    for (const edge of edges)
      expect(edge.ariaLabel).toMatch(/^.+ leads to .+$/);
  });

  it("places a concept below the ones that lead to it", () => {
    const { nodes, edges } = layoutMap(courseMap, COURSE_ID);
    const y = (id: string) => nodes.find((node) => node.id === id)!.position.y;
    expect(edges).toHaveLength(courseMap.edges.length);
    for (const edge of edges)
      expect(y(edge.target)).toBeGreaterThan(y(edge.source));
  });

  it("drops edges to unknown concepts, self-loops and duplicates", () => {
    const { cell, membrane } = CONCEPT_IDS;
    const { edges } = layoutMap(
      {
        nodes: courseMap.nodes.filter(
          (node) => node.id === cell || node.id === membrane,
        ),
        edges: [
          { from: cell, to: membrane },
          { from: cell, to: membrane },
          { from: cell, to: cell },
          { from: cell, to: CONCEPT_IDS.atp },
          { from: "cmissing00000000000000000", to: membrane },
        ],
      },
      COURSE_ID,
    );
    expect(edges).toEqual([
      {
        id: `${cell}->${membrane}`,
        source: cell,
        target: membrane,
        ariaLabel: "Cell theory leads to Cell membrane",
      },
    ]);
  });

  it("lays out a cycle without failing", () => {
    const { cell, membrane, osmosis } = CONCEPT_IDS;
    const ids: string[] = [cell, membrane, osmosis];
    const { nodes, edges } = layoutMap(
      {
        nodes: courseMap.nodes.filter((node) => ids.includes(node.id)),
        edges: [
          { from: cell, to: membrane },
          { from: membrane, to: osmosis },
          { from: osmosis, to: cell },
        ],
      },
      COURSE_ID,
    );
    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(3);
    for (const node of nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
    }
  });

  it("lays out 100 concepts without overlapping any two", () => {
    const { nodes } = layoutMap(bigMap(100), COURSE_ID);
    expect(nodes).toHaveLength(100);
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        expect(overlaps(nodes[i]!.position, nodes[j]!.position)).toBe(false);
  });

  it("lays out 100 unconnected concepts", () => {
    const { nodes } = layoutMap(bigMap(100, 0), COURSE_ID);
    const positions = new Set(
      nodes.map(({ position }) => `${position.x},${position.y}`),
    );
    expect(positions.size).toBe(100);
  });
});

describe("practiceHref", () => {
  it("encodes both ids", () => {
    expect(practiceHref("a/b", "c?d")).toBe(
      "/courses/a%2Fb/practice?concept=c%3Fd",
    );
  });
});
