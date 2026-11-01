// The request schemas for every operation in openapi/openapi.yaml, keyed by operationId.
// Adding an operation to the spec without an entry here (or the reverse) is a type error.
import type { z } from "zod";
import type { operations } from "@/lib/api-client/schema";
import { IdParams } from "./common";
import { CreateCourseBody } from "./courses";
import { UploadDocumentForm } from "./documents";
import { AnswerBody } from "./questions";

export { Id, ID_PATTERN, IdParams, LIMITS, text } from "./common";
export { CreateCourseBody } from "./courses";
export { UploadDocumentForm } from "./documents";
export { AnswerBody } from "./questions";

interface RequestSchemas {
  body?: z.ZodType;
  params?: z.ZodType;
}

export const requestSchemas = {
  getHealth: {},
  getOpenApiDocument: {},
  getApiReference: {},
  listCourses: {},
  createCourse: { body: CreateCourseBody },
  getCourse: { params: IdParams },
  listCourseConcepts: { params: IdParams },
  getCourseMap: { params: IdParams },
  getNextConcept: { params: IdParams },
  uploadDocument: { body: UploadDocumentForm },
  getDocument: { params: IdParams },
  createQuestion: { params: IdParams },
  answerQuestion: { params: IdParams, body: AnswerBody },
} satisfies Record<keyof operations, RequestSchemas>;
