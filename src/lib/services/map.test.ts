// The map's edge shaping without a database (T21). The database usually returns a concept's edges
// already sorted by `to` (the unique (fromId, toId) index), so only here can the sort be shown to
// be the code's own. The queries themselves are covered in tests/integration/progress.int.test.ts.
import { describe, expect, it, vi } from "vitest";
import { mapEdges } from "./map";

vi.mock("@/lib/db", () => ({ db: {} }));

describe("mapEdges", () => {
  it("sorts by `from`, then `to`, whatever order the rows arrive in", () => {
    expect(
      mapEdges([
        {
          id: "cb",
          outEdges: [{ toId: "cz" }, { toId: "ca" }, { toId: "cm" }],
        },
        { id: "ca", outEdges: [{ toId: "cb" }] },
      ]),
    ).toEqual([
      { from: "ca", to: "cb" },
      { from: "cb", to: "ca" },
      { from: "cb", to: "cm" },
      { from: "cb", to: "cz" },
    ]);
  });

  it("compares as plain strings, not by locale", () => {
    // localeCompare would put "cB" after "ca"; code-unit order puts uppercase first.
    expect(
      mapEdges([{ id: "cx", outEdges: [{ toId: "ca" }, { toId: "cB" }] }]),
    ).toEqual([
      { from: "cx", to: "cB" },
      { from: "cx", to: "ca" },
    ]);
  });

  it("drops an edge from a concept to itself and keeps the rest", () => {
    expect(
      mapEdges([{ id: "ca", outEdges: [{ toId: "ca" }, { toId: "cb" }] }]),
    ).toEqual([{ from: "ca", to: "cb" }]);
  });

  it("returns no edges for concepts with none", () => {
    expect(mapEdges([])).toEqual([]);
    expect(mapEdges([{ id: "ca", outEdges: [] }])).toEqual([]);
  });
});
