import { z } from "zod";
import { Id, LIMITS, text } from "./common";

/**
 * A form field left empty counts as not sent. A browser posts a file input with nothing chosen as
 * an empty part with no file name, and an empty text box as "" (or whitespace, once cleared).
 */
const unlessEmpty = (value: unknown) =>
  (typeof value === "string" && value.trim() === "") ||
  (value instanceof File && value.size === 0 && value.name === "")
    ? undefined
    : value;

/**
 * POST /api/documents (multipart). The route builds this object from the form fields.
 * Size, type and note-length checks happen before or after it: the body limit in withApi() and
 * extractText (413, 400 UNSUPPORTED_TYPE, 422), so a long `text` or an empty named file passes here.
 */
export const UploadDocumentForm = z
  .object({
    courseId: Id,
    title: text(LIMITS.documentTitle),
    file: z.preprocess(unlessEmpty, z.file().optional()),
    text: z.preprocess(unlessEmpty, text().optional()),
  })
  .strict()
  .refine((form) => form.file !== undefined || form.text !== undefined, {
    message: "Send a file or paste your notes as text.",
  })
  .refine((form) => form.file === undefined || form.text === undefined, {
    message: "Send either a file or text, not both.",
  });
