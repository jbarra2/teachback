import { describe, expect, it } from "vitest";
import { unwrap } from "@/lib/api-client";
import { rejection } from "@/lib/api-client/test-helpers";
import { COURSE_ID } from "@/lib/api-client/fake-api/fixtures";
import { mockClient, networkClient } from "./test-clients";
import { uploadDocument } from "./upload-document";

const accepted = () =>
  Response.json(
    { id: "cdocument0000000000000099", status: "QUEUED" },
    { status: 202 },
  );

async function sentFields(
  network: ReturnType<typeof networkClient>["network"],
) {
  expect(network).toHaveBeenCalledOnce();
  const request = network.mock.calls[0]![0];
  return { request, fields: Object.fromEntries(await request.formData()) };
}

describe("uploadDocument", () => {
  it("posts a file as multipart with the course and title", async () => {
    const { client, network } = networkClient(async () => accepted());
    const file = new File(["Cells are alive."], "week3.md");
    const document = await uploadDocument(client, COURSE_ID, "Week 3", {
      file,
    });
    const { request, fields } = await sentFields(network);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/documents");
    expect(request.headers.get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(fields.courseId).toBe(COURSE_ID);
    expect(fields.title).toBe("Week 3");
    expect(fields.file).toBeInstanceOf(File);
    expect(await (fields.file as File).text()).toBe("Cells are alive.");
    expect(fields).not.toHaveProperty("text");
    expect(document).toMatchObject({
      id: "cdocument0000000000000099",
      title: "Week 3",
      status: "QUEUED",
    });
  });

  it("posts pasted text without a file", async () => {
    const { client, network } = networkClient(async () => accepted());
    await uploadDocument(client, COURSE_ID, "Week 4", { text: "Osmosis." });
    const { fields } = await sentFields(network);
    expect(fields).toEqual({
      courseId: COURSE_ID,
      title: "Week 4",
      text: "Osmosis.",
    });
  });

  it("is accepted by the mocks, and the new document steps to READY", async () => {
    const client = mockClient();
    const file = new File(["Cells are alive."], "notes.txt");
    const document = await uploadDocument(client, COURSE_ID, "Notes", {
      file,
    });
    const poll = () =>
      unwrap(
        client.GET("/api/documents/{id}", {
          params: { path: { id: document.id } },
        }),
      );
    expect((await poll()).status).toBe("PROCESSING");
    expect((await poll()).status).toBe("READY");
  });

  it("throws the server's error", async () => {
    const { client } = networkClient(async () =>
      Response.json(
        {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "This upload is too large.",
          },
        },
        { status: 413 },
      ),
    );
    const error = await rejection(
      uploadDocument(client, COURSE_ID, "Big", { text: "x" }),
    );
    expect(error).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "This upload is too large.",
    });
  });
});
