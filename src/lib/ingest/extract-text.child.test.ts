import {
  type ChildProcess,
  fork,
  type ForkOptions,
  spawn,
} from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractText,
  ingestLimits,
  PDF_CHILD_ENTRY,
  PDF_CHILD_HEAP_MB,
  PDF_MEMORY_BUDGET_MB,
  PDF_TIMEOUT_MS,
  readPdf,
} from "./extract-text";
import {
  MEMORY_WATCHDOG_INTERVAL_MS,
  PDF_CHILD_FLAG,
  type PdfRequest,
} from "./pdf-child";

// These start real child processes with real hostile PDFs, built in memory below.

// Records every child started, keeping the real fork, so a test can check they all ended, and
// when each one started, exited and closed its IPC channel (for the timing diagnostics).
interface ChildTiming {
  started: number;
  exited?: number;
  closed?: number;
}
const forked = vi.hoisted(() => [] as ChildProcess[]);
const timings = vi.hoisted(() => new Map<ChildProcess, ChildTiming>());
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return {
    ...real,
    fork: (...args: Parameters<typeof real.fork>) => {
      const child = real.fork(...args);
      const timing: ChildTiming = { started: performance.now() };
      child.once("exit", () => (timing.exited = performance.now()));
      child.once("close", () => (timing.closed = performance.now()));
      forked.push(child);
      timings.set(child, timing);
      return child;
    },
  };
});

// Processes started outside readPdf, killed after each test in case an assertion failed first.
// Handles are only killed if Node hasn't seen them end; the orphaned PDF child, which isn't ours
// to reap, is only killed while the test hasn't seen it end, so a reused pid is never hit.
const strays: ChildProcess[] = [];
const orphans = new Set<number>();

afterEach(() => {
  forked.length = 0;
  timings.clear();
  for (const child of strays.splice(0))
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  for (const pid of orphans) if (isAlive(pid)) process.kill(pid, "SIGKILL");
  orphans.clear();
});

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Resolves with how long `pid` took to end, or Infinity if it's still running after `withinMs`. */
async function timeUntilGone(pid: number, withinMs: number) {
  const started = performance.now();
  while (performance.now() - started < withinMs) {
    if (!isAlive(pid)) return performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return Infinity;
}

function expectAllChildrenGone() {
  expect(forked.length).toBeGreaterThan(0);
  for (const child of forked)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
}

/** A PDF from raw objects: object n is `objects[n - 1]`; object 1 must be the catalog. */
function buildPdf(objects: (string | Buffer)[]): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    const part = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(body) ? body : Buffer.from(body),
      Buffer.from("\nendobj\n"),
    ]);
    offsets.push(length);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
          .join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return new Uint8Array(Buffer.concat(parts));
}

const stream = (data: Buffer) =>
  Buffer.concat([
    Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),
    data,
    Buffer.from("\nendstream"),
  ]);

/**
 * `pages` pages that share one compressed content stream, drawn in Helvetica. With `toUnicode`,
 * the font's CMap maps the glyph "A" to that text (hex UTF-16), however long.
 */
function pdfWithContent(
  content: Buffer,
  pages = 1,
  toUnicode?: string,
): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${5 + i} 0 R`).join(
    " ",
  );
  const cmap = toUnicode
    ? `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /X def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <${toUnicode}> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`
    : "";
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica${toUnicode ? " /ToUnicode 4 0 R" : ""} >>`,
    stream(deflateSync(cmap)),
    ...Array.from(
      { length: pages },
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + pages} 0 R >>`,
    ),
    stream(deflateSync(content)),
  ]);
}

const hex = (text: string) =>
  [...text].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");

function watchHeartbeat() {
  let last = performance.now();
  let maxGap = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 25);
  // The gap still open when it stops counts too: a fully blocked loop never ticks at all.
  return () => {
    clearInterval(timer);
    return Math.max(maxGap, performance.now() - last);
  };
}

/**
 * 40 pages sharing 16 MB of "save state, restore state" operators: no text and little memory,
 * but about a minute of parsing, so only a time limit ends it.
 */
const slowPdf = () =>
  pdfWithContent(Buffer.from("q Q\n".repeat(4 * 1024 * 1024)), 40);

/** A request as readPdf would send it, with a 1 s deadline for the child's own watchdog. */
const slowRequest = (): PdfRequest => ({
  data: slowPdf(),
  limits: { maxPdfPages: 100, maxNoteChars: 1000 },
  memoryBudgetBytes: 4096 * 1024 * 1024,
  deadlineMs: 1000,
});

const childOptions: ForkOptions = {
  execArgv: [`--max-old-space-size=${PDF_CHILD_HEAP_MB}`],
  env: { NODE_ENV: "test" },
  serialization: "advanced",
  stdio: ["ignore", "ignore", "ignore", "ipc"],
};

// Stands in for the server: starts the PDF child, hands it the request, reports its pid.
const STAND_IN_SERVER = `
const { fork } = require("node:child_process");
process.once("message", ({ entry, flag, options, request }) => {
  const child = fork(entry, [flag], options);
  child.send(request, () => process.send(child.pid));
});
`;

const cellBiology = () =>
  new Uint8Array(readFileSync("fixtures/notes/cell-biology.pdf"));

/** Milliseconds between two moments, or "never" if the second didn't happen. */
const ms = (from: number | undefined, to: number | undefined) =>
  from === undefined || to === undefined
    ? "never"
    : `${Math.round(to - from)} ms`;

// Real processes run much slower on a busy 2-CPU CI runner than locally, so these tests get more
// than Vitest's default 5 s. The production caps they check don't change.
describe("PDF parsing in a child process", { timeout: 20_000 }, () => {
  it("has the agreed caps", () => {
    expect(PDF_TIMEOUT_MS).toBe(15_000);
    expect(PDF_CHILD_HEAP_MB).toBe(256);
    expect(PDF_MEMORY_BUDGET_MB).toBe(512);
    expect(MEMORY_WATCHDOG_INTERVAL_MS).toBe(20);
  });

  it("kills a PDF that keeps the parser busy, without blocking the event loop", async () => {
    // One page whose 32 MB of text operators compress to well under 200 KB. In-process, PDF.js
    // blocked the event loop for seconds on it.
    const line = "BT /F1 12 Tf 72 712 Td (A) Tj ET\n";
    const pdf = pdfWithContent(
      Buffer.from(line.repeat(Math.ceil((32 * 1024 * 1024) / line.length))),
    );
    expect(pdf.byteLength).toBeLessThan(200 * 1024);
    const stop = watchHeartbeat();
    const started = performance.now();

    const error = await readPdf(pdf, ingestLimits(), {
      timeoutMs: 1000,
      memoryBudgetMb: 4096,
    }).catch((e: unknown) => e);

    expect(stop()).toBeLessThan(1000);
    expect(error).toMatchObject({ status: 422, reason: "UNREADABLE_PDF" });
    expect(performance.now() - started).toBeLessThan(6000);
    expectAllChildrenGone();
  });

  it("survives a 1 KB PDF that makes V8 abort, and keeps working", async ({
    annotate,
  }) => {
    // A glyph mapped to 30,000 characters, drawn 1,000 times: PDF.js runs out of heap in native
    // code, which aborts the whole process. With a worker thread, that was the server.
    const pdf = pdfWithContent(
      Buffer.from(`BT /F1 1 Tf 0 0 Td (${"A".repeat(1000)}) Tj ET`),
      1,
      hex("a".repeat(30_000)),
    );
    expect(pdf.byteLength).toBeLessThan(2 * 1024);
    const started = performance.now();
    let rejected: number | undefined;
    let recovered: number | undefined;

    try {
      await expect(
        readPdf(pdf, ingestLimits(), { memoryBudgetMb: 4096 }),
      ).rejects.toMatchObject({ status: 422, reason: "UNREADABLE_PDF" });
      rejected = performance.now();
      expectAllChildrenGone();
      // V8's fatal error aborted the child, not the time cap or the watchdog.
      expect(forked[0].signalCode).toBe("SIGABRT");
      await expect(
        extractText(cellBiology(), "cell-biology.pdf"),
      ).resolves.toContain("Selective permeability");
      recovered = performance.now();
    } finally {
      // Durations, the signal and the CPU count only, never any PDF text. Linux writes a crash
      // dump before it reports the exit, so a dump shows up as an abort that's slow compared
      // with the normal parse after it; slow cleanup shows up after the exit.
      const child = timings.get(forked[0]);
      await annotate(
        [
          `abort: ${ms(child?.started, child?.exited)} from fork to exit (${String(forked[0]?.signalCode)})`,
          `IPC closed ${ms(child?.exited, child?.closed)} after exit`,
          `rejected ${ms(child?.closed, rejected)} after close`,
          `next PDF parsed in ${ms(rejected, recovered)}`,
          `total ${ms(started, recovered ?? performance.now())}`,
          `${availableParallelism()} CPUs`,
        ].join(", "),
        "timing",
      );
    }
  });

  it("kills a PDF that grows past the memory budget, long before the time cap", async () => {
    // 256 MB of spaces in one content stream: PDF.js decodes it into ArrayBuffers that V8's heap
    // limit doesn't count. The watchdog thread in the child sees them in the process's RSS.
    const pdf = pdfWithContent(Buffer.alloc(256 * 1024 * 1024, 0x20));
    expect(pdf.byteLength).toBeLessThan(1024 * 1024);
    const started = performance.now();

    await expect(
      readPdf(pdf, ingestLimits(), {
        memoryBudgetMb: 128,
        timeoutMs: PDF_TIMEOUT_MS,
      }),
    ).rejects.toMatchObject({ status: 422, reason: "UNREADABLE_PDF" });
    expect(performance.now() - started).toBeLessThan(5000);
    expectAllChildrenGone();
  });

  it("never hands the server more than the note limit, however much whitespace a PDF holds", async () => {
    // Glyphs mapped to a control character plus 2,000 spaces: PDF.js keeps them as text, and
    // once the control character is stripped it's all whitespace, 100 pages of it.
    const pdf = pdfWithContent(
      Buffer.from(`BT /F1 0.001 Tf 0 0 Td (${"A".repeat(100)}) Tj ET`),
      100,
      hex("\u0001" + " ".repeat(2000)),
    );
    expect(pdf.byteLength).toBeLessThan(32 * 1024);

    await expect(readPdf(pdf, ingestLimits())).resolves.toBe("");
    await expect(extractText(pdf, "blank.pdf")).rejects.toMatchObject({
      status: 422,
      reason: "NO_TEXT",
    });
    expectAllChildrenGone();
  });

  it("kills itself at its own deadline, with no time cap from the server", async () => {
    expect(slowPdf().byteLength).toBeLessThan(64 * 1024);
    // Started directly, so no server-side timer exists: only the child's watchdog can end it.
    const child = fork(
      path.join(process.cwd(), PDF_CHILD_ENTRY),
      [PDF_CHILD_FLAG],
      childOptions,
    );
    strays.push(child);
    const started = performance.now();
    const exited = new Promise<NodeJS.Signals | null>((resolve) =>
      child.once("exit", (_code, signal) => resolve(signal)),
    );
    const answered = vi.fn();
    child.once("message", answered);
    child.send(slowRequest());

    await expect(exited).resolves.toBe("SIGKILL");
    const took = performance.now() - started;
    expect(took).toBeGreaterThanOrEqual(1000);
    expect(took).toBeLessThan(8000);
    expect(answered).not.toHaveBeenCalled();
  });

  it("doesn't outlive a server that dies while it's parsing", async () => {
    const server = spawn(process.execPath, ["-e", STAND_IN_SERVER], {
      env: { NODE_ENV: "test" },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    strays.push(server);
    const pid = await new Promise<number>((resolve) => {
      server.once("message", (message) => resolve(message as number));
      server.send({
        entry: path.join(process.cwd(), PDF_CHILD_ENTRY),
        flag: PDF_CHILD_FLAG,
        options: childOptions,
        request: slowRequest(),
      });
    });
    orphans.add(pid);

    // The server crashes mid-parse: nothing is left to enforce its time cap.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(isAlive(pid)).toBe(true);
    const serverGone = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGKILL");
    await serverGone;
    expect(isAlive(pid)).toBe(true);

    // Without its own deadline, the child would parse for about a minute more.
    const gone = await timeUntilGone(pid, 8000);
    if (gone < Infinity) orphans.delete(pid);
    expect(gone).toBeLessThan(8000);
  });

  it("fails closed when the child gets no valid deadline", async () => {
    // Without the check, NaN would turn the deadline off: `now > NaN` is always false.
    const child = fork(
      path.join(process.cwd(), PDF_CHILD_ENTRY),
      [PDF_CHILD_FLAG],
      childOptions,
    );
    strays.push(child);
    const exited = new Promise<NodeJS.Signals | null>((resolve) =>
      child.once("exit", (_code, signal) => resolve(signal)),
    );
    const started = performance.now();
    child.send({ ...slowRequest(), deadlineMs: Number.NaN });

    await expect(exited).resolves.toBe("SIGKILL");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("finishes a normal PDF well inside a short deadline", async () => {
    await expect(
      readPdf(cellBiology(), ingestLimits(), { timeoutMs: 8000 }),
    ).resolves.toContain("Selective permeability");
    expectAllChildrenGone();
  });

  it("ends the child after a normal PDF too", async () => {
    await expect(
      extractText(cellBiology(), "cell-biology.pdf"),
    ).resolves.toContain("phospholipid");
    expectAllChildrenGone();
  });
});
