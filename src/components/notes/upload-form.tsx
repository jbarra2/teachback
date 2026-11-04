"use client";
// Upload notes to a course (T15): a title, then a file or pasted text. The file is checked before
// anything is sent; the server checks everything again.
import { useRef, useState, type FormEvent } from "react";
import { Button, Card, Input, Textarea } from "@/components/ui";
import {
  ApiError,
  type ApiClient,
  type DocumentSummary,
} from "@/lib/api-client";
import { LIMITS } from "@/lib/schemas";
import { errorMessage } from "./error-message";
import { ACCEPT, fileError, titleFromFile } from "./file-checks";
import { uploadDocument } from "./upload-document";

type Mode = "file" | "text";
type Errors = Partial<Record<"title" | "file" | "text", string>>;

interface UploadFormProps {
  courseId: string;
  client: ApiClient;
  /** Called with the new document, QUEUED, once the server has accepted it. */
  onUploaded: (document: DocumentSummary) => void;
  /** Tests pass a stand-in (jsdom's File can't go into a real multipart request). */
  upload?: typeof uploadDocument;
}

export function UploadForm({
  courseId,
  client,
  onUploaded,
  upload = uploadDocument,
}: UploadFormProps) {
  const [mode, setMode] = useState<Mode>("file");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File>();
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState(false);
  // Bumped to clear the file input, which can't be controlled.
  const [fileKey, setFileKey] = useState(0);
  // State updates on the next render; this blocks a second submit right away.
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  function chooseFile(chosen: File | undefined) {
    setFile(chosen);
    setNotice(undefined);
    setErrors((current) => ({
      ...current,
      file: chosen && fileError(chosen),
    }));
    if (chosen && !title.trim()) setTitle(titleFromFile(chosen));
  }

  function validate(): Errors {
    const found: Errors = {};
    if (!title.trim()) found.title = "Enter a title.";
    if (mode === "file") {
      if (!file) found.file = "Choose a file to upload.";
      else found.file = fileError(file);
    } else if (!text.trim()) found.text = "Paste your notes.";
    for (const key of Object.keys(found) as (keyof Errors)[])
      if (!found[key]) delete found[key];
    return found;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    setNotice(undefined);
    const found = validate();
    setErrors(found);
    const firstInvalid = (["title", "file", "text"] as const).find(
      (name) => name in found,
    );
    if (firstInvalid) {
      formRef.current
        ?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)
        ?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    try {
      // validate() made sure a file is chosen in file mode.
      const notes = mode === "file" && file ? { file } : { text };
      onUploaded(await upload(client, courseId, title.trim(), notes));
      setTitle("");
      setFile(undefined);
      setText("");
      setFileKey((n) => n + 1);
    } catch (caught) {
      const details =
        caught instanceof ApiError ? caught.details?.fieldErrors : undefined;
      const titleError = details?.title?.[0];
      if (titleError) setErrors({ title: titleError });
      else setNotice(errorMessage(caught));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Card>
      <form
        ref={formRef}
        noValidate
        aria-label="Upload notes"
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <h2 className="text-lg font-semibold">Upload notes</h2>
        <Input
          id="upload-title"
          name="title"
          label="Title"
          placeholder="e.g. Week 3 - Osmosis"
          maxLength={LIMITS.documentTitle}
          showCount
          value={title}
          error={errors.title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <fieldset className="flex gap-4 text-sm">
          <legend className="sr-only">Notes from</legend>
          {(
            [
              ["file", "A file"],
              ["text", "Pasted text"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => {
                  setMode(value);
                  setErrors({});
                  setNotice(undefined);
                  // The file input remounts empty, so forget its file too.
                  setFile(undefined);
                  setFileKey((n) => n + 1);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {mode === "file" ? (
          <Input
            key={fileKey}
            id="upload-file"
            name="file"
            type="file"
            label="File"
            hint="A .txt, .md or text-based .pdf file, up to about 4 MB."
            accept={ACCEPT}
            error={errors.file}
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
        ) : (
          <Textarea
            id="upload-text"
            name="text"
            label="Pasted notes"
            maxLength={LIMITS.noteChars}
            showCount
            value={text}
            error={errors.text}
            onChange={(event) => setText(event.target.value)}
          />
        )}
        {notice && (
          <p role="alert" className="text-sm text-danger">
            {notice}
          </p>
        )}
        <Button type="submit" loading={pending} className="self-start">
          Upload
        </Button>
      </form>
    </Card>
  );
}
