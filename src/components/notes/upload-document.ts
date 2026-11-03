// POST /api/documents as multipart: the course, a title, and a file or pasted text.
import { unwrap, type ApiClient, type DocumentSummary } from "@/lib/api-client";

export type UploadNotes = { file: File } | { text: string };

/** Sends the notes and returns the new document, QUEUED. Throws an ApiError when it's refused. */
export async function uploadDocument(
  client: ApiClient,
  courseId: string,
  title: string,
  notes: UploadNotes,
): Promise<DocumentSummary> {
  const accepted = await unwrap(
    client.POST("/api/documents", {
      body: { courseId, title, ...notes },
      bodySerializer(body) {
        const form = new FormData();
        for (const [key, value] of Object.entries(body))
          if (value !== undefined) form.append(key, value);
        return form;
      },
    }),
  );
  return {
    id: accepted.id,
    title,
    status: accepted.status,
    createdAt: new Date().toISOString(),
  };
}
