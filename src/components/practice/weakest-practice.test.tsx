import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "@/lib/api-client";
import { GENERIC_MESSAGE, NETWORK_MESSAGE } from "@/lib/api-client/errors";
import { MOCK_KEYS, type MockKey } from "@/lib/mocks/config";
import {
  COURSE_2_ID,
  COURSE_ID,
  nextConcept,
  question,
} from "@/lib/mocks/fixtures";
import { RATE_LIMITED_MESSAGE } from "./error-message";
import { WeakestPractice } from "./weakest-practice";

type Network = (request: Request) => Promise<Response>;

const ALL_BUT_NEXT = MOCK_KEYS.filter((key) => key !== "next");

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

function renderWeakest(api = client(), courseId: string = COURSE_ID) {
  return render(<WeakestPractice courseId={courseId} client={api} />);
}

async function answerAndWaitForFeedback() {
  fireEvent.change(
    await screen.findByLabelText("Explain it in your own words"),
    { target: { value: "Water moves toward more solute." } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Submit answer/ }));
  await screen.findByRole("region", { name: "Feedback" });
}

const weakest = () => screen.getByText(/Your weakest concept:/).parentElement;

describe("WeakestPractice", () => {
  it("finds the weakest concept, then shows its name, state and a question", async () => {
    renderWeakest();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finding your weakest concept…",
    );
    expect(
      await screen.findByRole("heading", { name: question.text }),
    ).toBeInTheDocument();
    expect(weakest()).toHaveTextContent(nextConcept.name);
    expect(weakest()).toHaveTextContent("Practice");
  });

  it("runs the loop: answer, feedback, then Next concept picks the next one", async () => {
    renderWeakest();
    await screen.findByRole("heading", { name: question.text });
    await answerAndWaitForFeedback();
    expect(
      screen.queryByRole("button", { name: "Next question" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next concept" }));
    await screen.findByRole("heading", { name: question.text });
    expect(weakest()).not.toHaveTextContent(nextConcept.name);
    expect(
      screen.queryByRole("region", { name: "Feedback" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Explain it in your own words")).toHaveValue(
      "",
    );
  });

  it("asks for the next concept once, even when Next is clicked twice quickly", async () => {
    const network = vi.fn<Network>(async () => Response.json(nextConcept));
    renderWeakest(client({ mocked: ALL_BUT_NEXT, network }));
    await answerAndWaitForFeedback();
    const next = screen.getByRole("button", { name: "Next concept" });
    fireEvent.click(next);
    fireEvent.click(next);
    await screen.findByRole("heading", { name: question.text });
    expect(network).toHaveBeenCalledTimes(2); // the first pick, then one more
  });

  it("says there's nothing to practise when next-concept is null", async () => {
    renderWeakest(client(), COURSE_2_ID);
    expect(
      await screen.findByRole("heading", { name: "Nothing to practise yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the course" }),
    ).toHaveAttribute("href", `/courses/${COURSE_2_ID}`);
    expect(
      screen.queryByLabelText("Explain it in your own words"),
    ).not.toBeInTheDocument();
  });

  describe("error states", () => {
    it("shows a friendly message when rate-limited, and Try again recovers", async () => {
      const network = vi
        .fn<Network>()
        .mockImplementationOnce(apiError(429, "RATE_LIMITED", "Slow down."))
        .mockImplementation(async () => Response.json(nextConcept));
      renderWeakest(client({ mocked: ALL_BUT_NEXT, network }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't pick a concept");
      expect(alert).toHaveTextContent(RATE_LIMITED_MESSAGE);

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByRole("heading", { name: question.text }),
      ).toBeInTheDocument();
    });

    it("shows a generic message for a server error", async () => {
      renderWeakest(
        client({
          mocked: ALL_BUT_NEXT,
          network: async () =>
            new Response("<html>oops</html>", { status: 500 }),
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        GENERIC_MESSAGE,
      );
    });

    it("shows a fixed message when the network fails", async () => {
      renderWeakest(
        client({
          mocked: ALL_BUT_NEXT,
          network: async () => {
            throw new TypeError("Failed to fetch");
          },
        }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        NETWORK_MESSAGE,
      );
    });

    it("says the course wasn't found on a 404", async () => {
      renderWeakest(
        client({
          mocked: ALL_BUT_NEXT,
          network: apiError(404, "NOT_FOUND", "Not found."),
        }),
      );
      expect(
        await screen.findByRole("heading", { name: "Course not found" }),
      ).toBeInTheDocument();
    });

    it("doesn't ask the server about a malformed course id", () => {
      const network = vi.fn<Network>();
      renderWeakest(client({ mocked: [], network }), "not-an-id");
      expect(
        screen.getByRole("heading", { name: "Course not found" }),
      ).toBeInTheDocument();
      expect(network).not.toHaveBeenCalled();
    });
  });

  it("cancels the next-concept request on unmount", async () => {
    let signal: AbortSignal | undefined;
    const api = client({
      mocked: [],
      network: (request) => {
        signal = request.signal;
        return new Promise<Response>(() => {});
      },
    });
    const { unmount } = renderWeakest(api);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
