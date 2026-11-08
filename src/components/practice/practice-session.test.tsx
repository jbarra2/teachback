import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { GENERIC_MESSAGE, NETWORK_MESSAGE } from "@/lib/api-client/errors";
import { MOCK_KEYS, type MockKey } from "@/lib/mocks/config";
import {
  CONCEPT_IDS,
  COURSE_ID,
  answerResults,
  question,
} from "@/lib/mocks/fixtures";
import { AI_UNAVAILABLE_MESSAGE, RATE_LIMITED_MESSAGE } from "./error-message";
import { PracticeSession } from "./practice-session";

type Network = (request: Request) => Promise<Response>;

/** A client whose `mocked` endpoints answer from src/lib/mocks; the rest go to `network`. */
function client({
  mocked = MOCK_KEYS,
  network = async () => {
    throw new Error("unexpected request");
  },
}: { mocked?: readonly MockKey[]; network?: Network } = {}) {
  return createApiClient({
    baseUrl: "http://test.local",
    mocks: new Set(mocked),
    mockDelayMs: 0,
    fetch: vi.fn(network),
    onUnauthenticated: vi.fn(),
  });
}

function apiError(status: number, code: string, message: string): Network {
  return async () => Response.json({ error: { code, message } }, { status });
}

function renderSession(
  api = client(),
  conceptId: string = CONCEPT_IDS.osmosis,
) {
  return render(
    <PracticeSession courseId={COURSE_ID} conceptId={conceptId} client={api} />,
  );
}

const box = () => screen.getByLabelText("Explain it in your own words");
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: /Submit answer/ }));

async function answer(text: string) {
  fireEvent.change(
    await screen.findByLabelText("Explain it in your own words"),
    {
      target: { value: text },
    },
  );
  submit();
}

describe("PracticeSession", () => {
  it("shows a loading state, then the question and its sources", async () => {
    renderSession();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your question…",
    );
    expect(
      await screen.findByRole("heading", { name: question.text }),
    ).toBeInTheDocument();
    const sources = screen.getByRole("list", { name: "Sources" });
    expect(sources).toHaveTextContent("Week 1 - Cells, part 2");
    expect(screen.getByText("Why")).toBeInTheDocument();
  });

  it("shows feedback after an answer, then a fresh form on Next question", async () => {
    renderSession();
    await answer("Water moves toward more solute.");
    const feedback = await screen.findByRole("region", { name: "Feedback" });
    expect(feedback).toHaveTextContent("Correct");
    expect(feedback).toHaveTextContent(
      "You explained that water follows the solute gradient into the cell.",
    );
    expect(feedback).toHaveTextContent("Review");
    expect(
      screen.queryByRole("button", { name: /Submit answer/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    await screen.findByRole("heading", { name: question.text });
    expect(box()).toHaveValue("");
    expect(
      screen.queryByRole("region", { name: "Feedback" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an XSS payload in the answer as literal text alongside the feedback", async () => {
    const payload = `<img src=x onerror="alert(1)"><script>alert(2)</script>`;
    const { container } = renderSession();
    await answer(payload);
    await screen.findByRole("region", { name: "Feedback" });
    expect(box()).toHaveValue(payload);
    expect(container.querySelector("img, script")).toBeNull();
  });

  it("hands Next to onNext as Next concept when practising weakest", async () => {
    const onNext = vi.fn();
    render(
      <PracticeSession
        courseId={COURSE_ID}
        conceptId={CONCEPT_IDS.osmosis}
        client={client()}
        onNext={onNext}
      />,
    );
    await answer("Water moves toward more solute.");
    await screen.findByRole("region", { name: "Feedback" });
    expect(
      screen.queryByRole("button", { name: "Next question" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next concept" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("sends the answer once, even when submitted twice quickly", async () => {
    const network = vi.fn<Network>(async () =>
      Response.json(
        { error: { code: "INTERNAL", message: "x" } },
        { status: 500 },
      ),
    );
    const api = client({ mocked: ["question"], network });
    renderSession(api);
    await answer("Osmosis");
    submit();
    fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
    await screen.findByRole("alert");
    expect(network).toHaveBeenCalledOnce();
  });

  it("renders an HTML-looking answer and question as plain text", async () => {
    const payload = '<img src=x onerror="alert(1)">';
    const api = client({
      mocked: ["answer"],
      network: async () =>
        Response.json({ ...question, text: payload, sources: [] }),
    });
    const { container } = renderSession(api);
    expect(
      await screen.findByRole("heading", { name: payload }),
    ).toBeInTheDocument();
    fireEvent.change(box(), { target: { value: payload } });
    expect(box()).toHaveValue(payload);
    expect(container.querySelector("img")).toBeNull();
  });

  describe("error states", () => {
    it.each([
      [502, "AI_UNAVAILABLE", AI_UNAVAILABLE_MESSAGE],
      [429, "RATE_LIMITED", RATE_LIMITED_MESSAGE],
      [400, "VALIDATION_ERROR", "Some fields are invalid."],
    ])(
      "shows a %i %s on answer and keeps the answer",
      async (status, code, shown) => {
        const api = client({
          mocked: ["question"],
          network: apiError(status, code, "Some fields are invalid."),
        });
        renderSession(api);
        await answer("Water moves toward more solute.");
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Couldn't send your answer");
        expect(alert).toHaveTextContent(shown);
        expect(box()).toHaveValue("Water moves toward more solute.");
        expect(
          screen.getByRole("button", { name: /Submit answer/ }),
        ).toBeEnabled();
      },
    );

    it("shows a fixed message when the network fails", async () => {
      const api = client({
        mocked: ["question"],
        network: async () => {
          throw new TypeError("Failed to fetch");
        },
      });
      renderSession(api);
      await answer("Osmosis");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        NETWORK_MESSAGE,
      );
    });

    it("shows a generic message for a non-JSON error page", async () => {
      const api = client({
        mocked: ["question"],
        network: async () => new Response("<h1>oops</h1>", { status: 500 }),
      });
      renderSession(api);
      await answer("Osmosis");
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(GENERIC_MESSAGE);
      expect(alert).not.toHaveTextContent("oops");
    });

    it("sends again from Submit after an error, clearing it on success", async () => {
      let calls = 0;
      const api = client({
        mocked: ["question"],
        network: async (request) => {
          calls += 1;
          return calls === 1
            ? apiError(502, "AI_UNAVAILABLE", "Unavailable.")(request)
            : Response.json(answerResults[0]);
        },
      });
      renderSession(api);
      await answer("Osmosis");
      await screen.findByRole("alert");
      submit();
      expect(
        await screen.findByRole("region", { name: "Feedback" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(calls).toBe(2);
    });

    it("can retry a question that failed to load", async () => {
      let calls = 0;
      const api = client({
        mocked: [],
        network: async (request) => {
          calls += 1;
          return calls === 1
            ? apiError(502, "AI_UNAVAILABLE", "Unavailable.")(request)
            : Response.json(question);
        },
      });
      renderSession(api);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load a question");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByRole("heading", { name: question.text }),
      ).toBeInTheDocument();
    });

    it("says the concept wasn't found on a 404", async () => {
      renderSession(client(), "cconcept00000000000000099");
      expect(
        await screen.findByRole("heading", { name: "Concept not found" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Choose a concept" }),
      ).toHaveAttribute("href", `/courses/${COURSE_ID}/practice`);
    });

    it("doesn't ask the server about a malformed concept id", () => {
      const network = vi.fn<Network>();
      renderSession(client({ mocked: [], network }), "not-an-id");
      expect(
        screen.getByRole("heading", { name: "Concept not found" }),
      ).toBeInTheDocument();
      expect(network).not.toHaveBeenCalled();
    });
  });

  it("cancels the question request on unmount", async () => {
    let signal: AbortSignal | undefined;
    const api = client({
      mocked: [],
      network: (request) => {
        signal = request.signal;
        return new Promise<Response>(() => {});
      },
    });
    const { unmount } = renderSession(api);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
