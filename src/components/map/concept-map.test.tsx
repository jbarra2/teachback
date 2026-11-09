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

  // T32: at 390 px the skip link was 20 px tall and the list's links 24 px (browser walk). The links
  // inside the graph scale with its zoom; this list is their full-size equivalent.
  it("makes the skip link and every listed concept at least 44 px tall to tap", async () => {
    render(<ConceptMap courseId={COURSE_ID} client={client()} />);
    await screen.findByRole("region", { name: "Concept map" });
    expect(
      screen.getByRole("link", { name: "Skip to the concept list" }),
    ).toHaveClass("inline-flex", "min-h-11");
    for (const link of within(conceptList()).getAllByRole("link"))
      expect(link).toHaveClass("min-h-11");
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
    // T32: a way out that stands alone, so it's tap-sized (44 px).
    expect(screen.getByRole("link", { name: "Go to the course" })).toHaveClass(
      "min-h-11",
    );
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

  // T32: another student's course (or an unknown or malformed id) once showed as an error with
  // "Try again", unlike the course and practice pages.
  describe("a course it can't show", () => {
    it.each([
      ["another student's course or an unknown id", 404, "NOT_FOUND"],
      ["a malformed id", 400, "VALIDATION_ERROR"],
    ])("says %s isn't found, with a way back", async (_name, status, code) => {
      render(
        <ConceptMap
          courseId={COURSE_ID}
          client={client(async () =>
            Response.json({ error: { code, message: "Nope." } }, { status }),
          )}
          actions={<a href="/elsewhere">Course action</a>}
        />,
      );
      expect(
        await screen.findByRole("heading", { name: "Course not found" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Back to your courses" }),
      ).toHaveAttribute("href", "/courses");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Try again" }),
      ).not.toBeInTheDocument();
      // Nothing that only makes sense for a course you can see.
      expect(
        screen.queryByRole("link", { name: "Course action" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("the course's actions (Practice weakest)", () => {
    const actions = <a href="/elsewhere">Course action</a>;
    const action = () => screen.queryByRole("link", { name: "Course action" });

    it("shows them once the map has loaded, not before", async () => {
      render(
        <ConceptMap courseId={COURSE_ID} client={client()} actions={actions} />,
      );
      expect(action()).not.toBeInTheDocument();
      await screen.findByRole("region", { name: "Concept map" });
      expect(action()).toBeInTheDocument();
    });

    it("shows them for a course with no concepts yet", async () => {
      render(
        <ConceptMap
          courseId={COURSE_2_ID}
          client={client()}
          actions={actions}
        />,
      );
      await screen.findByRole("heading", { name: "No concepts yet" });
      expect(action()).toBeInTheDocument();
    });

    it("leaves them out when the map can't load", async () => {
      render(
        <ConceptMap
          courseId={COURSE_ID}
          client={client(async () => new Response(null, { status: 500 }))}
          actions={actions}
        />,
      );
      await screen.findByRole("alert");
      expect(action()).not.toBeInTheDocument();
    });
  });

  describe("errors", () => {
    it.each([
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
