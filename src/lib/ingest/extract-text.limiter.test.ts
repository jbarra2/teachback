import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { IngestLimits } from "./errors";

// `fork` is replaced by fake children the tests drive by hand, to check the limiter, the time cap
// and every way a child can end, without starting real processes.
class FakeChild extends EventEmitter {
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  sent: unknown[] = [];
  killedWith: string[] = [];
  sendError: Error | null = null;

  send(message: unknown, callback: (error: Error | null) => void) {
    this.sent.push(message);
    queueMicrotask(() => callback(this.sendError));
    return true;
  }

  kill(signal: NodeJS.Signals) {
    this.killedWith.push(signal);
    this.exit(null, signal);
    return true;
  }

  /** Ends the child as Node would: "exit", then "close" once the IPC channel is drained. */
  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.exitOnly(code, signal);
    queueMicrotask(() => this.emit("close", code, signal));
  }

  /** Only the "exit" part, which Node can report before it has read the child's answer. */
  exitOnly(code: number | null, signal: NodeJS.Signals | null = null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", code, signal));
  }

  answer(message: unknown) {
    this.emit("message", message);
  }
}

const children: FakeChild[] = [];
const fork = vi.fn<(...args: unknown[]) => FakeChild>(() => {
  const child = new FakeChild();
  children.push(child);
  return child;
});
vi.mock("node:child_process", () => ({ fork }));

let readPdf: typeof import("./extract-text").readPdf;
let C: typeof import("./extract-text");

const LIMITS: IngestLimits = {
  maxUploadMb: 4,
  maxNoteChars: 100,
  maxPdfPages: 100,
};
const PDF = new TextEncoder().encode("%PDF-1.7\nfake");

/** Lets queued microtasks (sends, exits, slot hand-offs) run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Answers every child, including ones started as slots free up, until all calls settle. */
async function drain(calls: Promise<unknown>[]) {
  const answered = new Set<FakeChild>();
  for (let round = 0; round < 10; round++) {
    for (const child of children)
      if (!answered.has(child)) {
        answered.add(child);
        child.answer({ text: "x" });
      }
    await settle();
  }
  return Promise.allSettled(calls);
}

/** Two new parses start at once, so no earlier parse still holds a slot. */
async function expectBothSlotsFree() {
  const before = fork.mock.calls.length;
  const calls = [readPdf(PDF, LIMITS), readPdf(PDF, LIMITS)];
  await settle();
  expect(fork.mock.calls.length - before).toBe(2);
  children.at(-2)!.answer({ text: "x" });
  children.at(-1)!.answer({ text: "x" });
  await Promise.all(calls);
}

beforeEach(async () => {
  vi.useFakeTimers();
  // A fresh module per test, so each starts with a free limiter.
  vi.resetModules();
  C = await import("./extract-text");
  readPdf = C.readPdf;
  children.length = 0;
  fork.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("PDF child process", () => {
  it("returns the child's text and kills the child afterwards", async () => {
    const result = readPdf(PDF, LIMITS);
    await settle();
    children[0].answer({ text: "Notes" });
    await expect(result).resolves.toBe("Notes");
    expect(children[0].killedWith).toEqual(["SIGKILL"]);
  });

  it("maps the child's reasons to IngestErrors", async () => {
    const result = readPdf(PDF, LIMITS);
    await settle();
    children[0].answer({ reason: "TOO_MANY_PAGES" });
    await expect(result).rejects.toMatchObject({
      status: 413,
      reason: "TOO_MANY_PAGES",
    });
  });

  it("sends the bytes, the limits, the memory budget and the time cap as the child's deadline", async () => {
    const result = readPdf(PDF, LIMITS, { memoryBudgetMb: 64 });
    await settle();
    expect(children[0].sent).toEqual([
      {
        data: PDF,
        limits: { maxPdfPages: 100, maxNoteChars: 100 },
        memoryBudgetBytes: 64 * 1024 * 1024,
        deadlineMs: 15_000,
      },
    ]);
    children[0].answer({ text: "x" });
    await result;
  });

  it("starts the child with a heap cap and none of the app's secrets", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-not-a-real-key");
    vi.stubEnv("DATABASE_URL", "postgres://user:secret@localhost/db");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
    const result = readPdf(PDF, LIMITS);
    await settle();
    const [entry, args, options] = fork.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; execArgv: string[]; stdio: unknown[] },
    ];
    expect(entry.endsWith(C.PDF_CHILD_ENTRY)).toBe(true);
    expect(args).toContain("--teachback-pdf-child");
    expect(options.execArgv).toEqual([
      `--max-old-space-size=${C.PDF_CHILD_HEAP_MB}`,
    ]);
    expect(
      Object.keys(options.env).every((k) =>
        ["NODE_ENV", "SYSTEMROOT"].includes(k),
      ),
    ).toBe(true);
    expect(JSON.stringify(options.env)).not.toMatch(/sk-ant|secret/);
    expect(options.stdio).toEqual(["ignore", "ignore", "ignore", "ipc"]);
    children[0].answer({ text: "x" });
    await result;
  });

  it("kills the child with SIGKILL at the time cap (422)", async () => {
    const result = readPdf(PDF, LIMITS, { timeoutMs: 1000 });
    const assertion = expect(result).rejects.toMatchObject({
      status: 422,
      reason: "UNREADABLE_PDF",
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(children[0].killedWith).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(children[0].killedWith).toEqual(["SIGKILL"]);
  });

  it.each([
    ["crashes (e.g. V8 out of memory)", (c: FakeChild) => c.exit(134)],
    [
      "is killed by its memory watchdog",
      (c: FakeChild) => c.exit(null, "SIGKILL"),
    ],
    [
      "reports an error",
      (c: FakeChild) => c.emit("error", new Error("kill failed")),
    ],
  ])("answers 422 when the child %s", async (_, end) => {
    const result = readPdf(PDF, LIMITS);
    await settle();
    end(children[0]);
    if (children[0].exitCode === null && children[0].signalCode === null)
      children[0].exit(1);
    await expect(result).rejects.toMatchObject({
      status: 422,
      reason: "UNREADABLE_PDF",
    });
  });

  it("answers 429 when fork throws (e.g. ENOMEM), and frees the slot", async () => {
    for (let i = 0; i < 3; i++) {
      fork.mockImplementationOnce(() => {
        throw Object.assign(new Error("spawn ENOMEM"), { code: "ENOMEM" });
      });
      await expect(readPdf(PDF, LIMITS)).rejects.toMatchObject({
        status: 429,
        reason: "PDF_BUSY",
        retryAfterSeconds: 15,
      });
    }
    await expectBothSlotsFree();
  });

  it("answers 429 when the child never starts (e.g. EMFILE), without waiting for an exit that never comes", async () => {
    // Node's real behaviour: no pid and no send(), "error" on the next tick, and no "exit" ever.
    const neverStarts = () => {
      const child = new FakeChild();
      child.pid = undefined;
      child.exitCode = -24;
      process.nextTick(() =>
        child.emit(
          "error",
          Object.assign(new Error("spawn EMFILE"), { code: "EMFILE" }),
        ),
      );
      children.push(child);
      return child;
    };
    for (let i = 0; i < 3; i++) {
      fork.mockImplementationOnce(neverStarts);
      await expect(readPdf(PDF, LIMITS)).rejects.toMatchObject({
        status: 429,
        reason: "PDF_BUSY",
      });
    }
    await settle();
    expect(children.every((c) => c.sent.length === 0)).toBe(true);
    await expectBothSlotsFree();
  });

  it("still reads an answer that arrives after the child's exit", async () => {
    const result = readPdf(PDF, LIMITS);
    await settle();
    // The child answered and exited, but Node reported the exit first.
    children[0].exitOnly(0);
    await settle();
    children[0].answer({ text: "late but valid" });
    children[0].emit("close", 0, null);
    await expect(result).resolves.toBe("late but valid");
  });

  it("answers 422 when the child closes without an answer", async () => {
    const result = readPdf(PDF, LIMITS);
    await settle();
    children[0].exitOnly(0);
    await settle();
    children[0].emit("close", 0, null);
    await expect(result).rejects.toMatchObject({
      status: 422,
      reason: "UNREADABLE_PDF",
    });
  });

  it("answers 422 when the request can't be sent", async () => {
    fork.mockImplementationOnce(() => {
      const child = new FakeChild();
      child.sendError = new Error("channel closed");
      children.push(child);
      return child;
    });
    await expect(readPdf(PDF, LIMITS)).rejects.toMatchObject({
      reason: "UNREADABLE_PDF",
    });
  });

  it.each([
    ["a non-string text", { text: 5 }],
    ["an unknown reason", { reason: "SOMETHING_ELSE" }],
    ["extra fields", { text: "x", injected: true }],
    ["text far over the note limit", { text: "a".repeat(201) }],
    ["nothing useful", "hello"],
  ])("treats %s from the child as unreadable (422)", async (_, message) => {
    const result = readPdf(PDF, LIMITS);
    await settle();
    children[0].answer(message);
    await expect(result).rejects.toMatchObject({
      status: 422,
      reason: "UNREADABLE_PDF",
    });
    expect(children[0].killedWith).toEqual(["SIGKILL"]);
  });
});

describe("PDF parse limiter", () => {
  const start = async (n: number, options = {}) => {
    const calls = Array.from({ length: n }, () =>
      readPdf(PDF, LIMITS, options),
    );
    // Some of these end on their own time cap before the test looks at them.
    for (const call of calls) call.catch(() => undefined);
    await settle();
    return calls;
  };

  it(`runs at most ${2} parses at once and queues the rest`, async () => {
    expect(C.MAX_ACTIVE_PDF_PARSES).toBe(2);
    const [a, b, c] = await start(3);
    expect(fork).toHaveBeenCalledTimes(2);
    children[0].answer({ text: "a" });
    await expect(a).resolves.toBe("a");
    await settle();
    expect(fork).toHaveBeenCalledTimes(3);
    children[1].answer({ text: "b" });
    children[2].answer({ text: "c" });
    await expect(Promise.all([b, c])).resolves.toEqual(["b", "c"]);
  });

  it("rejects with 429 and Retry-After when the queue is full", async () => {
    expect(C.MAX_QUEUED_PDF_PARSES).toBe(4);
    const running = await start(6);
    const error = await readPdf(PDF, LIMITS).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
      reason: "PDF_BUSY",
      retryAfterSeconds: 15,
    });
    expect(fork).toHaveBeenCalledTimes(2);
    const results = await drain(running);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(fork).toHaveBeenCalledTimes(6);
  });

  it("gives up on a queued request after the queue wait (429), and forgets it", async () => {
    expect(C.PDF_QUEUE_WAIT_MS).toBe(30_000);
    const [a, b, queued] = await start(3, { timeoutMs: 60_000 });
    const assertion = expect(queued).rejects.toMatchObject({
      status: 429,
      reason: "PDF_BUSY",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    children[0].answer({ text: "a" });
    children[1].answer({ text: "b" });
    await Promise.all([a, b]);
    await settle();
    // The expired request never got a child, and both slots are free again.
    expect(fork).toHaveBeenCalledTimes(2);
    const next = readPdf(PDF, LIMITS);
    await settle();
    expect(fork).toHaveBeenCalledTimes(3);
    children[2].answer({ text: "c" });
    await expect(next).resolves.toBe("c");
  });

  it("starts the time cap only once a queued request gets a slot", async () => {
    const [a, b, queued] = await start(3, { timeoutMs: 15_000 });
    // a and b hold the slots for 20 s; a ends by answering, b by hitting its own cap.
    await vi.advanceTimersByTimeAsync(14_000);
    children[0].answer({ text: "a" });
    await a;
    await settle();
    expect(children).toHaveLength(3);
    const settled = vi.fn();
    queued.then(settled, settled);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).not.toHaveBeenCalled();
    children[2].answer({ text: "q" });
    await expect(queued).resolves.toBe("q");
    await expect(b).rejects.toMatchObject({ reason: "UNREADABLE_PDF" });
  });

  it("frees the slot however the parse ends", async () => {
    const endings: ((c: FakeChild) => void)[] = [
      (c) => c.answer({ text: "ok" }),
      (c) => c.answer({ reason: "TEXT_TOO_LONG" }),
      (c) => c.exit(134),
      (c) => c.answer({ bogus: true }),
    ];
    for (const end of endings) {
      const calls = await start(2);
      end(children.at(-2)!);
      end(children.at(-1)!);
      await Promise.allSettled(calls);
    }
    // A timed-out parse frees its slot too.
    const timedOut = await start(2, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.allSettled(timedOut);
    // Both slots are free: two new parses start at once.
    const before = fork.mock.calls.length;
    const last = await start(2);
    expect(fork.mock.calls.length - before).toBe(2);
    children.at(-2)!.answer({ text: "x" });
    children.at(-1)!.answer({ text: "x" });
    await Promise.all(last);
  });
});
