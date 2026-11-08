// The request itself (multipart, the mocks) is tested in upload-document.test.ts, in Node: jsdom's
// File can't go into Node's FormData. Here a stand-in upload records what the form sends.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type DocumentSummary } from "@/lib/api-client";
import { COURSE_ID } from "@/lib/api-client/fake-api/fixtures";
import { MAX_FILE_BYTES } from "./file-checks";
import { mockClient } from "./test-clients";
import type { uploadDocument } from "./upload-document";
import { UploadForm } from "./upload-form";

const queued: DocumentSummary = {
  id: "cdocument0000000000000099",
  title: "Week 3",
  status: "QUEUED",
  createdAt: "2026-11-02T17:00:00.000Z",
};

type Upload = typeof uploadDocument;

function renderForm(upload: Upload = vi.fn(async () => queued)) {
  const onUploaded = vi.fn();
  const client = mockClient();
  render(
    <UploadForm
      courseId={COURSE_ID}
      client={client}
      onUploaded={onUploaded}
      upload={upload}
    />,
  );
  return { onUploaded, upload: vi.mocked(upload), client };
}

function file(name: string, size?: number) {
  const made = new File(["Cells are alive."], name, { type: "text/plain" });
  if (size !== undefined) Object.defineProperty(made, "size", { value: size });
  return made;
}

const title = () => screen.getByLabelText("Title");
const fileInput = () => screen.getByLabelText("File");
const choose = (chosen: File) =>
  fireEvent.change(fileInput(), { target: { files: [chosen] } });
const submit = () =>
  act(async () =>
    fireEvent.click(screen.getByRole("button", { name: /Upload/ })),
  );
const usePastedText = () =>
  fireEvent.click(screen.getByRole("radio", { name: "Pasted text" }));

describe("UploadForm", () => {
  it("limits the file picker to the accepted types, and the title's length", () => {
    renderForm();
    expect(fileInput()).toHaveAttribute("accept", ".txt,.md,.pdf");
    expect(title()).toHaveAttribute("maxlength", "200");
  });

  it.each([
    ["virus.exe", undefined, "Upload a .txt, .md or text-based .pdf file."],
    ["empty.txt", 0, "This file is empty."],
    ["huge.pdf", MAX_FILE_BYTES + 1, "This file is too large."],
  ])(
    "rejects %s as soon as it's chosen, and never sends it",
    async (name, size, message) => {
      const { upload } = renderForm();
      choose(file(name, size));
      expect(fileInput()).toHaveAccessibleDescription(
        expect.stringContaining(message),
      );
      await submit();
      expect(upload).not.toHaveBeenCalled();
    },
  );

  it("sends the chosen file, with the title taken from its name", async () => {
    const { upload, onUploaded, client } = renderForm();
    const chosen = file("Week 3 - Osmosis.md");
    choose(chosen);
    expect(title()).toHaveValue("Week 3 - Osmosis");
    await submit();
    expect(upload).toHaveBeenCalledWith(client, COURSE_ID, "Week 3 - Osmosis", {
      file: chosen,
    });
    expect(onUploaded).toHaveBeenCalledWith(queued);
    expect(title()).toHaveValue("");
  });

  it("keeps a title the student already typed", () => {
    renderForm();
    fireEvent.change(title(), { target: { value: "My notes" } });
    choose(file("lecture.txt"));
    expect(title()).toHaveValue("My notes");
  });

  it("sends pasted text, with the title trimmed", async () => {
    const { upload, client } = renderForm();
    usePastedText();
    fireEvent.change(title(), { target: { value: "  Week 4  " } });
    fireEvent.change(screen.getByLabelText("Pasted notes"), {
      target: { value: "Osmosis moves water." },
    });
    await submit();
    expect(upload).toHaveBeenCalledWith(client, COURSE_ID, "Week 4", {
      text: "Osmosis moves water.",
    });
  });

  it("caps pasted text at the note limit, with a counter", () => {
    renderForm();
    usePastedText();
    expect(screen.getByLabelText("Pasted notes")).toHaveAttribute(
      "maxlength",
      "200000",
    );
    expect(screen.getByText("0 / 200000")).toBeInTheDocument();
  });

  it("asks for a title and a file before sending anything", async () => {
    const { upload } = renderForm();
    await submit();
    expect(title()).toHaveAccessibleDescription(
      expect.stringContaining("Enter a title."),
    );
    expect(title()).toHaveFocus();
    expect(fileInput()).toHaveAccessibleDescription(
      expect.stringContaining("Choose a file to upload."),
    );
    expect(upload).not.toHaveBeenCalled();
  });

  // Regression (PR #59 review): the remounted picker showed "No file chosen" while the old file
  // was still sent.
  it("forgets the chosen file when switching to pasted text and back", async () => {
    const { upload } = renderForm();
    choose(file("week3.txt"));
    usePastedText();
    fireEvent.click(screen.getByRole("radio", { name: "A file" }));
    await submit();
    expect(fileInput()).toHaveAccessibleDescription(
      expect.stringContaining("Choose a file to upload."),
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("asks for text when pasting and the box is blank", async () => {
    const { upload } = renderForm();
    usePastedText();
    fireEvent.change(title(), { target: { value: "Week 4" } });
    await submit();
    expect(screen.getByText("Paste your notes.")).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("shows the server's message when it refuses the file", async () => {
    const { onUploaded } = renderForm(
      vi.fn(async () => {
        throw new ApiError(
          "UNREADABLE_FILE",
          "We couldn't read any text in this file.",
          422,
        );
      }),
    );
    choose(file("scan.pdf"));
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn't read any text in this file.",
    );
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("shows a generic message, not the cause, for anything else", async () => {
    renderForm(
      vi.fn(async () => {
        throw new Error("db password=hunter2");
      }),
    );
    choose(file("notes.txt"));
    await submit();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Something went wrong. Please try again.",
    );
    expect(screen.queryByText(/hunter2/)).toBeNull();
  });

  it("shows the server's title error on the title field", async () => {
    renderForm(
      vi.fn(async () => {
        throw new ApiError(
          "VALIDATION_ERROR",
          "Some fields are invalid.",
          400,
          {
            formErrors: [],
            fieldErrors: {
              title: ["Contains characters that aren't allowed."],
            },
          },
        );
      }),
    );
    choose(file("notes.txt"));
    await submit();
    expect(title()).toHaveAccessibleDescription(
      expect.stringContaining("Contains characters that aren't allowed."),
    );
  });

  it("uploads once on a double submit", async () => {
    let finish = () => {};
    const { upload } = renderForm(
      vi.fn(
        () =>
          new Promise<DocumentSummary>((resolve) => {
            finish = () => resolve(queued);
          }),
      ),
    );
    choose(file("notes.txt"));
    const form = screen.getByRole("form", { name: "Upload notes" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => finish());
    expect(upload).toHaveBeenCalledOnce();
  });
});
