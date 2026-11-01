/**
 * Generated from openapi/openapi.yaml by `npm run api:types`. Do not edit by hand:
 * change the spec, then regenerate. `npm run api:types:check` (CI) fails if this file is stale.
 */

export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Report whether the app and its database are up
         * @description Public. Reports no versions or other internals.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/openapi": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Download this OpenAPI document
         * @description Public. Serves `openapi/openapi.yaml` unchanged. 404 unless `API_DOCS_ENABLED=true`.
         */
        get: operations["getOpenApiDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/docs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Browse this document as an interactive API reference
         * @description Public. Renders this document with Scalar. 404 unless `API_DOCS_ENABLED=true`.
         */
        get: operations["getApiReference"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/courses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List my courses
         * @description Newest first.
         */
        get: operations["listCourses"];
        put?: never;
        /** Create a course */
        post: operations["createCourse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/courses/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        /**
         * Get a course and its documents
         * @description Documents newest first.
         */
        get: operations["getCourse"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/courses/{id}/concepts": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        /**
         * List a course's concepts with my mastery
         * @description Sorted by name. A concept I haven't answered yet is PRACTICE with score 0 and 0 attempts.
         */
        get: operations["listCourseConcepts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/courses/{id}/map": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        /**
         * Get a course's concept map
         * @description Every concept in the course as a node, and how the concepts relate as edges.
         */
        get: operations["getCourseMap"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/courses/{id}/next-concept": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        /**
         * Pick the concept I should practise next
         * @description PRACTICE before REVIEW before MASTERED; within a state, the lowest score first, then the one seen longest ago (unseen first). Skips the concept of my most recent answer in this course unless it is the only one. `null` when the course has no concepts yet.
         */
        get: operations["getNextConcept"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload notes to a course
         * @description Send exactly one of `file` (a .txt, .md or text-based .pdf) or `text`. The whole request may be at most 4 MB (`MAX_UPLOAD_MB`): one with no `Content-Length`, or over the limit, gets 413 before the body is read. Processing runs after the response: poll `GET /api/documents/{id}` until the status is READY or FAILED.
         */
        post: operations["uploadDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The document's id.
                 * @example cdocument0000000000000001
                 */
                id: components["parameters"]["DocumentId"];
            };
            cookie?: never;
        };
        /**
         * Check a document's processing status
         * @description A document still QUEUED or PROCESSING 10 minutes after upload is reported as FAILED, so nothing stays stuck.
         */
        get: operations["getDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/concepts/{id}/question": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The concept's id.
                 * @example cconcept00000000000000001
                 */
                id: components["parameters"]["ConceptId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Get a new question about a concept
         * @description Asks Claude for a question that can be answered from my notes alone, avoiding the last five questions on this concept. Takes no request body.
         */
        post: operations["createQuestion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/questions/{id}/answer": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The question's id.
                 * @example cquestion0000000000000001
                 */
                id: components["parameters"]["QuestionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Answer a question and get feedback
         * @description Claude grades the answer against my notes. Every quote in `evidence` has been checked to appear in the cited note section; if none survive the check, `unsupported` is true and `confidence` is LOW. LOW confidence leaves mastery unchanged.
         */
        post: operations["answerQuestion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * @description A cuid, as Prisma's `cuid()` generates.
         * @example ccourse000000000000000001
         */
        Id: string;
        /**
         * Format: date-time
         * @example 2026-11-01T09:15:00.000Z
         */
        Timestamp: string;
        /** @description Mastery score from 0 to 1 (docs/PLAN.md §9). */
        Score: number;
        /**
         * @description MASTERED when score ≥ 0.75 after at least 2 attempts (shown as "Seems understood"); REVIEW after at least 1 attempt with score ≥ 0.4; PRACTICE otherwise, including unseen concepts.
         * @enum {string}
         */
        MasteryState: "MASTERED" | "REVIEW" | "PRACTICE";
        /** @enum {string} */
        DocumentStatus: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
        /** @enum {string} */
        QuestionKind: "EXPLAIN" | "WHY" | "COMPARE" | "APPLY";
        /** @enum {string} */
        Verdict: "CORRECT" | "PARTIAL" | "INCORRECT";
        /** @enum {string} */
        Confidence: "HIGH" | "MEDIUM" | "LOW";
        /** @description 1–120 characters after trimming. */
        CourseName: string;
        /** @description 1–200 characters after trimming. */
        DocumentTitle: string;
        /** @description 1–4000 characters after trimming. */
        AnswerText: string;
        /** @description Pasted notes. Longer than 200,000 characters (`MAX_NOTE_CHARS`) gets 413 PAYLOAD_TOO_LARGE, as does a file whose extracted text is that long. */
        NoteText: string;
        Health: {
            /** @enum {string} */
            status: "ok" | "error";
            /** @enum {string} */
            db: "up" | "down";
        };
        Course: {
            id: components["schemas"]["Id"];
            name: components["schemas"]["CourseName"];
            createdAt: components["schemas"]["Timestamp"];
        };
        CreateCourseRequest: {
            name: components["schemas"]["CourseName"];
        };
        DocumentSummary: {
            id: components["schemas"]["Id"];
            title: components["schemas"]["DocumentTitle"];
            /** @description Still QUEUED or PROCESSING 10 minutes after upload reads as FAILED, as in `GET /api/documents/{id}`. */
            status: components["schemas"]["DocumentStatus"];
            /** @description Present only when the status is FAILED. Safe to show to the user. */
            error?: string;
            createdAt: components["schemas"]["Timestamp"];
        };
        CourseDetail: {
            id: components["schemas"]["Id"];
            name: components["schemas"]["CourseName"];
            createdAt: components["schemas"]["Timestamp"];
            documents: components["schemas"]["DocumentSummary"][];
        };
        CourseConcept: {
            id: components["schemas"]["Id"];
            name: string;
            summary: string;
            state: components["schemas"]["MasteryState"];
            score: components["schemas"]["Score"];
            attempts: number;
        };
        /** @description Exactly one of `file` or `text`. An empty field counts as not sent: a file input with nothing chosen (an empty part with no file name) or an empty text box. */
        UploadDocumentRequest: {
            courseId: components["schemas"]["Id"];
            title: components["schemas"]["DocumentTitle"];
            /** @description A .txt, .md or text-based .pdf file. */
            file?: Blob;
            text?: components["schemas"]["NoteText"];
        };
        DocumentAccepted: {
            id: components["schemas"]["Id"];
            /** @constant */
            status: "QUEUED";
        };
        DocumentState: {
            id: components["schemas"]["Id"];
            status: components["schemas"]["DocumentStatus"];
            /** @description Present only when the status is FAILED. Safe to show to the user. */
            error?: string;
            conceptCount: number;
        };
        QuestionSource: {
            chunkId: components["schemas"]["Id"];
            /** @description Where the section comes from, e.g. "Week 1 - Cells, part 1". */
            refLabel: string;
        };
        Question: {
            questionId: components["schemas"]["Id"];
            text: string;
            kind: components["schemas"]["QuestionKind"];
            /** @description The note sections the question is based on. Only sections of this concept appear; ids the model made up are dropped. */
            sources: components["schemas"]["QuestionSource"][];
        };
        AnswerRequest: {
            answer: components["schemas"]["AnswerText"];
        };
        Evidence: {
            chunkId: components["schemas"]["Id"];
            /** @description Where the cited section comes from, e.g. "Week 1 - Cells, part 1". Added by the server from the note section, never by the model. */
            refLabel: string;
            /** @description Appears word for word (after normalizing whitespace and quotes) in the cited section. */
            quote: string;
        };
        /** @description Claude's grading (docs/PLAN.md §8) after evidence verification. `unsupported` is set only by the server's check, never by the model. */
        Feedback: {
            verdict: components["schemas"]["Verdict"];
            whatCorrect: string;
            whatMissing: string;
            /** @description The quotes that passed verification (the model gives 1–3; any that fail are removed). */
            evidence: components["schemas"]["Evidence"][];
            confidence: components["schemas"]["Confidence"];
            /** @description True when the answer relies on things the notes don't cover. */
            outsideNotes: boolean;
            /** @description True when none of the evidence could be found in the notes. */
            unsupported: boolean;
        };
        MasteryResult: {
            state: components["schemas"]["MasteryState"];
            score: components["schemas"]["Score"];
        };
        AnswerResult: {
            attemptId: components["schemas"]["Id"];
            feedback: components["schemas"]["Feedback"];
            mastery: components["schemas"]["MasteryResult"];
        };
        MapNode: {
            id: components["schemas"]["Id"];
            name: string;
            state: components["schemas"]["MasteryState"];
            score: components["schemas"]["Score"];
        };
        /** @description The concept `from` leads to or underpins the concept `to`. */
        MapEdge: {
            from: components["schemas"]["Id"];
            to: components["schemas"]["Id"];
        };
        CourseMap: {
            nodes: components["schemas"]["MapNode"][];
            edges: components["schemas"]["MapEdge"][];
        };
        NextConcept: {
            conceptId: components["schemas"]["Id"];
            name: string;
            state: components["schemas"]["MasteryState"];
        };
        /** @enum {string} */
        ErrorCode: "VALIDATION_ERROR" | "UNSUPPORTED_TYPE" | "UNAUTHENTICATED" | "FORBIDDEN_ORIGIN" | "NOT_FOUND" | "PAYLOAD_TOO_LARGE" | "UNREADABLE_FILE" | "RATE_LIMITED" | "INTERNAL" | "AI_UNAVAILABLE";
        /** @description Which inputs were wrong. `fieldErrors` is keyed by field name (body field or path parameter); `formErrors` holds problems with the request as a whole, such as an unknown field or malformed JSON. */
        ValidationDetails: {
            formErrors: string[];
            fieldErrors: {
                [key: string]: string[];
            };
        };
        ErrorResponse: {
            error: {
                code: components["schemas"]["ErrorCode"];
                /** @description A sentence that is safe to show to the user. */
                message: string;
                details?: components["schemas"]["ValidationDetails"];
            };
        };
    };
    responses: {
        /** @description VALIDATION_ERROR. A field, path parameter or the body is invalid. */
        ValidationError: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "VALIDATION_ERROR",
                 *         "message": "Some fields are invalid.",
                 *         "details": {
                 *           "formErrors": [],
                 *           "fieldErrors": {
                 *             "name": [
                 *               "Must be at most 120 characters."
                 *             ]
                 *           }
                 *         }
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description VALIDATION_ERROR for an invalid field, or UNSUPPORTED_TYPE for a file that isn't text, Markdown or PDF (checked by its content, not only its name). */
        UploadRejected: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description UNAUTHENTICATED. No valid session. */
        Unauthenticated: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "UNAUTHENTICATED",
                 *         "message": "Please sign in."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description FORBIDDEN_ORIGIN. The request came from another site. */
        ForbiddenOrigin: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "FORBIDDEN_ORIGIN",
                 *         "message": "This request isn't allowed from another site."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description NOT_FOUND. It doesn't exist, or it belongs to someone else. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "NOT_FOUND",
                 *         "message": "Not found."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description PAYLOAD_TOO_LARGE. The body, the upload or the note text is over its limit. */
        PayloadTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "PAYLOAD_TOO_LARGE",
                 *         "message": "That's too large."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description UNREADABLE_FILE. No text could be read from the file (for example a scanned or empty PDF). */
        UnreadableFile: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "UNREADABLE_FILE",
                 *         "message": "We couldn't read any text in that file."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description RATE_LIMITED. Too many requests; wait `Retry-After` seconds. */
        RateLimited: {
            headers: {
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "RATE_LIMITED",
                 *         "message": "Too many requests. Please wait a moment."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description INTERNAL. Something went wrong on the server. No internal details are included. */
        Internal: {
            headers: {
                "x-request-id": components["headers"]["RequestId"];
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "INTERNAL",
                 *         "message": "Something went wrong. Please try again."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description AI_UNAVAILABLE. The AI service failed, timed out or returned something unusable. */
        AiUnavailable: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "error": {
                 *         "code": "AI_UNAVAILABLE",
                 *         "message": "The AI service is unavailable right now."
                 *       }
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
    };
    parameters: {
        /**
         * @description The course's id.
         * @example ccourse000000000000000001
         */
        CourseId: components["schemas"]["Id"];
        /**
         * @description The document's id.
         * @example cdocument0000000000000001
         */
        DocumentId: components["schemas"]["Id"];
        /**
         * @description The concept's id.
         * @example cconcept00000000000000001
         */
        ConceptId: components["schemas"]["Id"];
        /**
         * @description The question's id.
         * @example cquestion0000000000000001
         */
        QuestionId: components["schemas"]["Id"];
    };
    requestBodies: never;
    headers: {
        /** @description Seconds to wait before trying again. */
        RetryAfter: number;
        /** @description Identifies this request in the server logs. Quote it when reporting a problem. */
        RequestId: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The app and its database are up. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "ok",
                     *       "db": "up"
                     *     }
                     */
                    "application/json": components["schemas"]["Health"];
                };
            };
            500: components["responses"]["Internal"];
            /** @description The app is up but can't reach its database. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "error",
                     *       "db": "down"
                     *     }
                     */
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getOpenApiDocument: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description This document, as YAML. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/yaml": string;
                };
            };
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    getApiReference: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description An HTML page that loads the Scalar API reference. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    listCourses: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The signed-in student's courses. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example [
                     *       {
                     *         "id": "ccourse000000000000000002",
                     *         "name": "Organic Chemistry",
                     *         "createdAt": "2026-11-02T18:30:00.000Z"
                     *       },
                     *       {
                     *         "id": "ccourse000000000000000001",
                     *         "name": "Biology 101",
                     *         "createdAt": "2026-11-01T09:15:00.000Z"
                     *       }
                     *     ]
                     */
                    "application/json": components["schemas"]["Course"][];
                };
            };
            401: components["responses"]["Unauthenticated"];
            500: components["responses"]["Internal"];
        };
    };
    createCourse: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCourseRequest"];
            };
        };
        responses: {
            /** @description The new course. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "ccourse000000000000000001",
                     *       "name": "Biology 101",
                     *       "createdAt": "2026-11-01T09:15:00.000Z"
                     *     }
                     */
                    "application/json": components["schemas"]["Course"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["ForbiddenOrigin"];
            413: components["responses"]["PayloadTooLarge"];
            500: components["responses"]["Internal"];
        };
    };
    getCourse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The course. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "ccourse000000000000000001",
                     *       "name": "Biology 101",
                     *       "createdAt": "2026-11-01T09:15:00.000Z",
                     *       "documents": [
                     *         {
                     *           "id": "cdocument0000000000000003",
                     *           "title": "Week 3 - Scanned handout",
                     *           "status": "FAILED",
                     *           "error": "We couldn't read any text in that file.",
                     *           "createdAt": "2026-11-03T08:45:00.000Z"
                     *         },
                     *         {
                     *           "id": "cdocument0000000000000002",
                     *           "title": "Week 2 - Cell membranes",
                     *           "status": "PROCESSING",
                     *           "createdAt": "2026-11-02T10:00:00.000Z"
                     *         },
                     *         {
                     *           "id": "cdocument0000000000000001",
                     *           "title": "Week 1 - Cells",
                     *           "status": "READY",
                     *           "createdAt": "2026-11-01T09:20:00.000Z"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["CourseDetail"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    listCourseConcepts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The course's concepts. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example [
                     *       {
                     *         "id": "cconcept00000000000000001",
                     *         "name": "Cell membrane",
                     *         "summary": "A lipid bilayer that controls what enters and leaves the cell.",
                     *         "state": "REVIEW",
                     *         "score": 0.5,
                     *         "attempts": 1
                     *       },
                     *       {
                     *         "id": "cconcept00000000000000002",
                     *         "name": "Mitochondria",
                     *         "summary": "Organelles that produce most of the cell's ATP.",
                     *         "state": "PRACTICE",
                     *         "score": 0,
                     *         "attempts": 0
                     *       }
                     *     ]
                     */
                    "application/json": components["schemas"]["CourseConcept"][];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    getCourseMap: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The concept map. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "nodes": [
                     *         {
                     *           "id": "cconcept00000000000000001",
                     *           "name": "Cell membrane",
                     *           "state": "REVIEW",
                     *           "score": 0.5
                     *         },
                     *         {
                     *           "id": "cconcept00000000000000002",
                     *           "name": "Mitochondria",
                     *           "state": "PRACTICE",
                     *           "score": 0
                     *         }
                     *       ],
                     *       "edges": [
                     *         {
                     *           "from": "cconcept00000000000000001",
                     *           "to": "cconcept00000000000000002"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["CourseMap"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    getNextConcept: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The course's id.
                 * @example ccourse000000000000000001
                 */
                id: components["parameters"]["CourseId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The next concept, or `null`. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NextConcept"] | null;
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    uploadDocument: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["UploadDocumentRequest"];
            };
        };
        responses: {
            /** @description Saved and queued for processing. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "cdocument0000000000000001",
                     *       "status": "QUEUED"
                     *     }
                     */
                    "application/json": components["schemas"]["DocumentAccepted"];
                };
            };
            400: components["responses"]["UploadRejected"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["ForbiddenOrigin"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            422: components["responses"]["UnreadableFile"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
        };
    };
    getDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The document's id.
                 * @example cdocument0000000000000001
                 */
                id: components["parameters"]["DocumentId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The document's status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DocumentState"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            404: components["responses"]["NotFound"];
            500: components["responses"]["Internal"];
        };
    };
    createQuestion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The concept's id.
                 * @example cconcept00000000000000001
                 */
                id: components["parameters"]["ConceptId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The question and the note sections it is based on. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "questionId": "cquestion0000000000000001",
                     *       "text": "In your own words, why does the cell membrane need to be selectively permeable?",
                     *       "kind": "WHY",
                     *       "sources": [
                     *         {
                     *           "chunkId": "cchunk0000000000000000001",
                     *           "refLabel": "Week 1 - Cells, part 1"
                     *         }
                     *       ]
                     *     }
                     */
                    "application/json": components["schemas"]["Question"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["ForbiddenOrigin"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["AiUnavailable"];
        };
    };
    answerQuestion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description The question's id.
                 * @example cquestion0000000000000001
                 */
                id: components["parameters"]["QuestionId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "answer": "It has to let nutrients in and keep harmful things out, so the cell can stay stable."
                 *     }
                 */
                "application/json": components["schemas"]["AnswerRequest"];
            };
        };
        responses: {
            /** @description Feedback and my updated mastery of the concept. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "attemptId": "cattempt00000000000000001",
                     *       "feedback": {
                     *         "verdict": "PARTIAL",
                     *         "whatCorrect": "You explained that the membrane controls what enters the cell.",
                     *         "whatMissing": "Mention that this keeps the cell's internal conditions stable.",
                     *         "evidence": [
                     *           {
                     *             "chunkId": "cchunk0000000000000000001",
                     *             "refLabel": "Week 1 - Cells, part 1",
                     *             "quote": "The cell membrane controls what enters and leaves."
                     *           }
                     *         ],
                     *         "confidence": "MEDIUM",
                     *         "outsideNotes": false,
                     *         "unsupported": false
                     *       },
                     *       "mastery": {
                     *         "state": "PRACTICE",
                     *         "score": 0.25
                     *       }
                     *     }
                     */
                    "application/json": components["schemas"]["AnswerResult"];
                };
            };
            400: components["responses"]["ValidationError"];
            401: components["responses"]["Unauthenticated"];
            403: components["responses"]["ForbiddenOrigin"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            429: components["responses"]["RateLimited"];
            500: components["responses"]["Internal"];
            502: components["responses"]["AiUnavailable"];
        };
    };
}
