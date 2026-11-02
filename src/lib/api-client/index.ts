export {
  api,
  createApiClient,
  redirectToLogin,
  unwrap,
  type ApiClient,
  type ApiClientOptions,
} from "./client";
export {
  ApiError,
  isAbortError,
  toApiError,
  type ApiErrorCode,
  type ErrorCode,
  type ValidationDetails,
} from "./errors";

import type { components } from "./schema";

type Schemas = components["schemas"];

export type Course = Schemas["Course"];
export type CourseDetail = Schemas["CourseDetail"];
export type DocumentSummary = Schemas["DocumentSummary"];
export type DocumentState = Schemas["DocumentState"];
export type DocumentStatus = Schemas["DocumentStatus"];
export type CourseConcept = Schemas["CourseConcept"];
export type MasteryState = Schemas["MasteryState"];
export type Question = Schemas["Question"];
export type AnswerResult = Schemas["AnswerResult"];
export type Feedback = Schemas["Feedback"];
export type CourseMap = Schemas["CourseMap"];
export type NextConcept = Schemas["NextConcept"];
