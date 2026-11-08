import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { GENERIC_MESSAGE, NETWORK_MESSAGE } from "@/lib/api-client/errors";
import { createFakeFetch } from "@/lib/api-client/fake-api/fake-fetch";
import {
  CONCEPT_IDS,
  COURSE_2_ID,
  COURSE_ID,
  courseMap,
} from "@/lib/api-client/fake-api/fixtures";
import { ConceptMap } from "./concept-map";

type Network = (request: Request) => Promise<Response>;

// jsdom lacks the layout APIs React Flow measures with (React Flow's testing guide stubs them).
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "DOMMatrixReadOnly",
    class {
      m22: number;
      constructor(transform?: string) {
        const scale = /scale\(([\d.]+)\)/.exec(transform ?? "")?.[1];
        this.m22 = scale ? Number(scale) : 1;
      }
    },
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** A client answering from the fake API, or from `network` when given. */
function client(network?: Network) {
  return createApiClient({
    baseUrl: "http://test.local",
    fetch: network ?? createFakeFetch(),
    onUnauthenticated: vi.fn(),
  });
}

const mapRegion = () => screen.getByRole("region", { name: "Concept map" });
const conceptList = () =>
  within(screen.getByRole("region", { name: "All concepts" })).getByRole(
    "list",
  );

describe("ConceptMap", () => {
  it("shows a loading state, then every concept as a node with its state in words", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading your map…");
    await screen.findByRole("region", { name: "Concept map" });
    const map = mapRegion();
    for (const node of courseMap.nodes)
      expect(
        within(map).getByRole("link", { name: new RegExp(`^${node.name}`) }),
      ).toBeInTheDocument();
    const osmosis = within(map).getByRole("link", { name: /^Osmosis/ });
    expect(osmosis).toHaveTextContent("Practice");
    expect(osmosis).toHaveClass("border-danger");
    expect(
      within(map).getByRole("link", { name: /^Cell theory/ }),
    ).toHaveTextContent("Seems understood");
  });

  it("links each node to practice for that concept", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    await screen.findByRole("region", { name: "Concept map" });
    expect(
      within(mapRegion()).getByRole("link", { name: /^Osmosis/ }),
    ).toHaveAttribute(
      "href",
      `/courses/${COURSE_ID}/practice?concept=${CONCEPT_IDS.osmosis}`,
    );
  });

  // Regression: a read-only node gets an inline `pointer-events: none` from React Flow, so a mouse
  // click fell through to the pane and never reached the link (PR #60 review).
  it("lets a mouse click reach a node's link", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    await screen.findByRole("region", { name: "Concept map" });
    const link = within(mapRegion()).getByRole("link", { name: /^Osmosis/ });
    const node = link.closest<HTMLElement>(".react-flow__node");
    expect(node).not.toBeNull();
    expect(node).toHaveStyle({ pointerEvents: "all" });
  });

  it("offers a way to skip past the map to the concept list", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    await screen.findByRole("region", { name: "Concept map" });
    expect(
      screen.getByRole("link", { name: "Skip to the concept list" }),
    ).toHaveAttribute("href", "#all-concepts");
  });

  it("explains the colors with a legend that names each state", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    const legend = await screen.findByRole("list", { name: "Legend" });
    const items = within(legend).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Seems understood"),
      expect.stringContaining("Review"),
      expect.stringContaining("Practice"),
    ]);
  });

  it("lists every concept as text with a practice link", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    await screen.findByRole("region", { name: "Concept map" });
    const items = within(conceptList()).getAllByRole("listitem");
    expect(items).toHaveLength(courseMap.nodes.length);
    const osmosis = within(conceptList()).getByRole("link", {
      name: "Osmosis",
    });
    expect(osmosis).toHaveAttribute(
      "href",
      `/courses/${COURSE_ID}/practice?concept=${CONCEPT_IDS.osmosis}`,
    );
  });

  it("shows an empty state for a course with no concepts", async () => {
    render(<ConceptMap courseId={COURSE_2_ID} client={client()} />);
    expect(
      await screen.findByRole("heading", { name: "No concepts yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the course" }),
    ).toHaveAttribute("href", `/courses/${COURSE_2_ID}`);
    expect(
      screen.queryByRole("region", { name: "Concept map" }),
    ).not.toBeInTheDocument();
  });

  it("renders 100 concepts", async () => {
    const id = (i: number) => `cconcept${String(i).padStart(16, "0")}`;
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      id: id(i),
      name: `Concept ${i}`,
      state: "PRACTICE" as const,
      score: 0,
    }));
    const edges = nodes
      .slice(1)
      .map((_, i) => ({ from: id(Math.floor(i / 2)), to: id(i + 1) }));
    render(
      <ConceptMap
        courseId={COURSE_ID}
        client={client(async () => Response.json({ nodes, edges }))}
      />,
    );
    await screen.findByRole("region", { name: "Concept map" });
    expect(within(conceptList()).getAllByRole("listitem")).toHaveLength(100);
    expect(
      within(mapRegion()).getByRole("link", { name: /^Concept 99/ }),
    ).toBeInTheDocument();
    // Lays out and renders 100 nodes: about 3 s alone, over 6 s in a busy `npm run verify` (#73).
    // Room for a loaded machine, like T42's heavy tests; every other test keeps the 5 s default.
  }, 60_000);

  it("renders an HTML-looking concept name as text", async () => {
    const name = '<img src=x onerror="alert(1)">';
    const map = {
      nodes: [{ id: CONCEPT_IDS.cell, name, state: "REVIEW", score: 0.5 }],
      edges: [],
    };
    const { container } = render(
      <ConceptMap
        courseId={COURSE_ID}
        client={client(async () => Response.json(map))}
      />,
    );
    expect(
      await within(
        await screen.findByRole("region", { name: "All concepts" }),
      ).findByRole("link", { name }),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  describe("errors", () => {
    it.each([
      [
        "a 404",
        async () =>
          Response.json(
            { error: { code: "NOT_FOUND", message: "Not found." } },
            { status: 404 },
          ),
        "Not found.",
      ],
      [
        "a non-JSON 500",
        async () => new Response("<h1>oops</h1>", { status: 500 }),
        GENERIC_MESSAGE,
      ],
      [
        "a network failure",
        async () => {
          throw new TypeError("Failed to fetch");
        },
        NETWORK_MESSAGE,
      ],
    ] as const)("shows %s as a safe message", async (_name, network, shown) => {
      render(<ConceptMap courseId={COURSE_ID} client={client(network)} />);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load the map");
      expect(alert).toHaveTextContent(shown);
      expect(alert).not.toHaveTextContent("oops");
    });

    it("retries after an error", async () => {
      let calls = 0;
      const network: Network = async () => {
        calls += 1;
        return calls === 1
          ? new Response(null, { status: 500 })
          : Response.json(courseMap);
      };
      render(<ConceptMap courseId={COURSE_ID} client={client(network)} />);
      await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByRole("region", { name: "Concept map" }),
      ).toBeInTheDocument();
      expect(calls).toBe(2);
    });
  });

  it("cancels the request on unmount", async () => {
    let signal: AbortSignal | undefined;
    const { unmount } = render(
      <ConceptMap
        courseId={COURSE_ID}
        client={client((request) => {
          signal = request.signal;
          return new Promise<Response>(() => {});
        })}
      />,
    );
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
