"use client";
// /courses/[courseId]/map (T25): the course's concepts as a graph, colored and labeled by mastery.
// It renders only on the client, after the data loads, so React Flow's inline positioning styles
// are set from JavaScript rather than sent in the server HTML (which a nonce-based CSP would block).
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CourseNotFound,
  isCourseMissing,
} from "@/components/notes/course-not-found";
import {
  cn,
  EmptyState,
  ErrorState,
  focusRing,
  MasteryBadge,
  Spinner,
  tapLink,
} from "@/components/ui";
import {
  ApiError,
  api,
  isAbortError,
  unwrap,
  type ApiClient,
  type CourseMap,
} from "@/lib/api-client";
import { GENERIC_MESSAGE } from "@/lib/api-client/errors";
import { ConceptNode } from "./concept-node";
import { layoutMap, practiceHref } from "./layout";
import { Legend } from "./legend";

const nodeTypes: NodeTypes = { concept: ConceptNode };

type MapState =
  | { status: "loading" }
  | { status: "ready"; map: CourseMap }
  | { status: "missing" }
  | { status: "error"; message: string };

interface ConceptMapProps {
  courseId: string;
  /** Links for this course (Practice weakest). Shown only once the map has loaded. */
  actions?: ReactNode;
  /** Tests pass a client with mocks or a failing network. */
  client?: ApiClient;
}

export function ConceptMap({
  courseId,
  actions,
  client = api,
}: ConceptMapProps) {
  const [state, setState] = useState<MapState>({ status: "loading" });
  // Bumped by "Try again".
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    unwrap(
      client.GET("/api/courses/{id}/map", {
        params: { path: { id: courseId } },
        signal: controller.signal,
      }),
    ).then(
      (map) => setState({ status: "ready", map }),
      (error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (isCourseMissing(error)) {
          setState({ status: "missing" });
          return;
        }
        // Only the contract's message or fixed text, never a raw error.
        const message =
          error instanceof ApiError ? error.message : GENERIC_MESSAGE;
        setState({ status: "error", message });
      },
    );
    return () => controller.abort();
  }, [client, courseId, attempt]);

  const graph = useMemo(
    () =>
      state.status === "ready" ? layoutMap(state.map, courseId) : undefined,
    [state, courseId],
  );

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  if (state.status === "loading")
    return <Spinner label="Loading your map…" className="self-center" />;

  if (state.status === "missing") return <CourseNotFound />;

  if (state.status === "error")
    return (
      <ErrorState
        title="Couldn't load the map"
        message={state.message}
        onRetry={retry}
      />
    );

  const courseHref = `/courses/${encodeURIComponent(courseId)}`;
  if (!graph || graph.nodes.length === 0)
    return (
      <div className="flex flex-col gap-4">
        {actions}
        <EmptyState
          title="No concepts yet"
          description="Upload notes for this course. Their concepts will show up here as a map."
          action={
            <Link href={courseHref} className={tapLink}>
              Go to the course
            </Link>
          }
        />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {actions}
      <Legend />
      <p className="text-sm text-muted">
        Arrows point from a concept to the ones that build on it. Select a
        concept to practice it.
      </p>
      {/* Every concept is also in the list below, so keyboard users can skip the map's tab stops. */}
      <a
        href="#all-concepts"
        className={cn(
          "inline-flex min-h-11 items-center self-start text-sm underline",
          focusRing,
        )}
      >
        Skip to the concept list
      </a>
      <div
        role="region"
        aria-label="Concept map"
        className="h-[70vh] min-h-96 rounded-lg border border-border"
      >
        <ReactFlow
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          // The links inside the nodes take focus; the node wrappers would be a second stop.
          nodesFocusable={false}
          edgesFocusable={false}
          // Its keyboard hints are about selecting and moving nodes, which this map doesn't allow.
          disableKeyboardA11y
          // The wheel and touch scroll the page; pinch and the controls zoom the map.
          zoomOnScroll={false}
          preventScrolling={false}
          colorMode="system"
          fitView
          // A small course isn't blown up to fill the map.
          fitViewOptions={{ maxZoom: 1 }}
          minZoom={0.1}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <section aria-labelledby="all-concepts" className="flex flex-col gap-2">
        {/* tabIndex lets the skip link move keyboard focus here, not just scroll. */}
        <h2 id="all-concepts" tabIndex={-1} className="text-lg font-semibold">
          All concepts
        </h2>
        <ul className="flex flex-col gap-2">
          {state.map.nodes.map((node) => (
            <li key={node.id} className="flex items-center gap-3">
              <Link href={practiceHref(courseId, node.id)} className={tapLink}>
                {node.name}
              </Link>
              <MasteryBadge state={node.state} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
