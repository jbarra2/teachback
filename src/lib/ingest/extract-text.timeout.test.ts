import { getDocumentProxy } from "unpdf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IngestError } from "./errors";
import { extractText, PDF_TIMEOUT_MS } from "./extract-text";

// The parser is mocked here so a hostile PDF that never finishes can be simulated with fake timers.
vi.mock("unpdf", () => ({ getDocumentProxy: vi.fn() }));

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
const mockedGetDocumentProxy = vi.mocked(getDocumentProxy);
const PDF = new TextEncoder().encode("%PDF-1.7\nhostile");
const never = <T>() => new Promise<T>(() => undefined);

function fakeDocument(getPage: () => Promise<unknown>) {
  const destroy = vi.fn(() => Promise.resolve());
  const doc = {
    numPages: 1,
    getPage,
    loadingTask: { destroy },
  } as unknown as PdfDocument;
  return { doc, destroy };
}

async function expectTimeout(promise: Promise<unknown>) {
  const assertion = expect(promise).rejects.toMatchObject({
    code: "UNREADABLE_FILE",
    status: 422,
    reason: "UNREADABLE_PDF",
  });
  await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS);
  await assertion;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  mockedGetDocumentProxy.mockReset();
});

describe("extractText: PDF time cap", () => {
  it("gives up when the page text never arrives, and frees the document", async () => {
    const { doc, destroy } = fakeDocument(() => never());
    mockedGetDocumentProxy.mockResolvedValue(doc);

    await expectTimeout(extractText(PDF, "slow.pdf"));
    expect(destroy).toHaveBeenCalled();
  });

  it("does not give up early", async () => {
    const { doc } = fakeDocument(() => never());
    mockedGetDocumentProxy.mockResolvedValue(doc);
    const settled = vi.fn();

    extractText(PDF, "slow.pdf").then(settled, settled);
    await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(expect.any(IngestError));
  });

  it("frees a document that finishes loading after the time cap", async () => {
    let finishLoading: (doc: PdfDocument) => void = () => undefined;
    mockedGetDocumentProxy.mockReturnValue(
      new Promise((resolve) => (finishLoading = resolve)),
    );
    const { doc, destroy } = fakeDocument(() => never());

    await expectTimeout(extractText(PDF, "slow.pdf"));
    expect(destroy).not.toHaveBeenCalled();

    finishLoading(doc);
    await vi.advanceTimersByTimeAsync(0);
    expect(destroy).toHaveBeenCalled();
  });

  it("stops reading pages once the text passes MAX_NOTE_CHARS", async () => {
    vi.stubEnv("MAX_NOTE_CHARS", "1000");
    const page = {
      getTextContent: () =>
        Promise.resolve({ items: [{ str: "a".repeat(600), hasEOL: false }] }),
    };
    const getPage = vi.fn(() => Promise.resolve(page));
    const { doc, destroy } = fakeDocument(getPage);
    Object.assign(doc, { numPages: 5 });
    mockedGetDocumentProxy.mockResolvedValue(doc);

    await expect(extractText(PDF, "long.pdf")).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      reason: "TEXT_TOO_LONG",
    });
    expect(getPage).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalled();
  });

  it("replaces a parser error with a generic one that quotes nothing", async () => {
    mockedGetDocumentProxy.mockRejectedValue(
      new Error("Invalid object 12: SECRET-NOTE text from the file"),
    );

    const error = await extractText(PDF, "bad.pdf").catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "UNREADABLE_FILE",
      reason: "UNREADABLE_PDF",
    });
    expect((error as Error).message).not.toMatch(/SECRET|Invalid object/);
  });
});
