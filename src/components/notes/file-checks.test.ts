import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/schemas";
import { MAX_FILE_BYTES, fileError, titleFromFile } from "./file-checks";

/** A file of `size` bytes without allocating them all: the checks only read name and size. */
function file(name: string, size = 10): File {
  const made = new File(["x"], name);
  Object.defineProperty(made, "size", { value: size });
  return made;
}

describe("fileError", () => {
  it.each(["notes.txt", "notes.md", "Lecture.PDF", "a.b.txt"])(
    "accepts %s",
    (name) => {
      expect(fileError(file(name))).toBeUndefined();
    },
  );

  it.each(["notes.exe", "notes.docx", "notes", "pdf", "notes.txt.exe"])(
    "rejects %s",
    (name) => {
      expect(fileError(file(name))).toBe(
        "Upload a .txt, .md or text-based .pdf file.",
      );
    },
  );

  it("rejects an empty file", () => {
    expect(fileError(file("notes.txt", 0))).toBe("This file is empty.");
  });

  it("accepts a file at the limit and rejects one byte over", () => {
    expect(fileError(file("notes.pdf", MAX_FILE_BYTES))).toBeUndefined();
    expect(fileError(file("notes.pdf", MAX_FILE_BYTES + 1))).toMatch(
      /too large/,
    );
  });

  it("leaves room under the server's request limit", () => {
    expect(MAX_FILE_BYTES).toBeLessThan(LIMITS.uploadBytes);
  });
});

describe("titleFromFile", () => {
  it("drops the extension", () => {
    expect(titleFromFile(file("Week 3 - Osmosis.pdf"))).toBe(
      "Week 3 - Osmosis",
    );
  });

  it("caps the title at its limit", () => {
    expect([...titleFromFile(file(`${"é".repeat(300)}.txt`))]).toHaveLength(
      LIMITS.documentTitle,
    );
  });
});
