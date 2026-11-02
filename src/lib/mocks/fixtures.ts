// Demo data for the mocks, typed with the generated contract types: change openapi.yaml and this
// file stops compiling until it matches again.
import type { components } from "@/lib/api-client/schema";

type Schemas = components["schemas"];

export const COURSE_ID = "ccourse000000000000000001";
export const COURSE_2_ID = "ccourse000000000000000002";
export const DOCUMENT_ID = "cdocument0000000000000001";

export const CONCEPT_IDS = {
  cell: "cconcept00000000000000001",
  membrane: "cconcept00000000000000002",
  osmosis: "cconcept00000000000000003",
  mitochondria: "cconcept00000000000000004",
  atp: "cconcept00000000000000005",
} as const;

export const CHUNK_ID = "cchunk0000000000000000001";

export const courses = [
  {
    id: COURSE_ID,
    name: "BIOL 180 · Intro Biology",
    createdAt: "2026-10-20T17:00:00.000Z",
  },
  {
    id: COURSE_2_ID,
    name: "CSE 142 · Programming I",
    createdAt: "2026-10-22T17:00:00.000Z",
  },
] satisfies Schemas["Course"][];

export const documentsByCourse: Record<string, Schemas["DocumentSummary"][]> = {
  [COURSE_ID]: [
    {
      id: DOCUMENT_ID,
      title: "Week 1 - Cells",
      status: "READY",
      createdAt: "2026-10-20T17:05:00.000Z",
    },
    {
      id: "cdocument0000000000000002",
      title: "Week 2 - Scanned handout",
      status: "FAILED",
      error: "We couldn't read any text in this file.",
      createdAt: "2026-10-27T17:05:00.000Z",
    },
  ],
  [COURSE_2_ID]: [],
};

export const concepts = [
  {
    id: CONCEPT_IDS.cell,
    name: "Cell theory",
    summary: "All living things are made of cells, the basic unit of life.",
    state: "MASTERED",
    score: 0.86,
    attempts: 3,
  },
  {
    id: CONCEPT_IDS.membrane,
    name: "Cell membrane",
    summary: "A phospholipid bilayer that controls what enters the cell.",
    state: "REVIEW",
    score: 0.55,
    attempts: 2,
  },
  {
    id: CONCEPT_IDS.osmosis,
    name: "Osmosis",
    summary:
      "Water moves across a membrane toward higher solute concentration.",
    state: "PRACTICE",
    score: 0.2,
    attempts: 1,
  },
  {
    id: CONCEPT_IDS.mitochondria,
    name: "Mitochondria",
    summary: "Organelles that make most of the cell's ATP.",
    state: "PRACTICE",
    score: 0,
    attempts: 0,
  },
  {
    id: CONCEPT_IDS.atp,
    name: "ATP",
    summary: "The molecule cells use to store and move energy.",
    state: "PRACTICE",
    score: 0,
    attempts: 0,
  },
] satisfies Schemas["CourseConcept"][];

export const courseMap = {
  nodes: concepts.map(({ id, name, state, score }) => ({
    id,
    name,
    state,
    score,
  })),
  edges: [
    { from: CONCEPT_IDS.cell, to: CONCEPT_IDS.membrane },
    { from: CONCEPT_IDS.membrane, to: CONCEPT_IDS.osmosis },
    { from: CONCEPT_IDS.cell, to: CONCEPT_IDS.mitochondria },
    { from: CONCEPT_IDS.mitochondria, to: CONCEPT_IDS.atp },
  ],
} satisfies Schemas["CourseMap"];

export const nextConcept = {
  conceptId: CONCEPT_IDS.osmosis,
  name: "Osmosis",
  state: "PRACTICE",
} satisfies Schemas["NextConcept"];

export const question = {
  questionId: "cquestion0000000000000001",
  text: "In your own words, why does water move into a cell placed in pure water?",
  kind: "WHY",
  sources: [{ chunkId: CHUNK_ID, refLabel: "Week 1 - Cells, part 2" }],
} satisfies Schemas["Question"];

const evidence = [
  {
    chunkId: CHUNK_ID,
    refLabel: "Week 1 - Cells, part 2",
    quote:
      "Water moves across the membrane toward the side with more dissolved solute.",
  },
] satisfies Schemas["Evidence"][];

/** One of each verdict; the answer mock cycles through them. */
export const answerResults = [
  {
    attemptId: "cattempt00000000000000001",
    feedback: {
      verdict: "CORRECT",
      whatCorrect:
        "You explained that water follows the solute gradient into the cell.",
      whatMissing: "Nothing important is missing.",
      evidence,
      confidence: "HIGH",
      outsideNotes: false,
      unsupported: false,
    },
    mastery: { state: "REVIEW", score: 0.6 },
  },
  {
    attemptId: "cattempt00000000000000002",
    feedback: {
      verdict: "PARTIAL",
      whatCorrect: "You said water moves into the cell.",
      whatMissing:
        "Explain why: the cell has more dissolved solute than pure water.",
      evidence,
      confidence: "MEDIUM",
      outsideNotes: false,
      unsupported: false,
    },
    mastery: { state: "REVIEW", score: 0.45 },
  },
  {
    attemptId: "cattempt00000000000000003",
    feedback: {
      verdict: "INCORRECT",
      whatCorrect: "You mentioned the membrane.",
      whatMissing:
        "Water moves toward higher solute concentration, not away from it.",
      evidence: [],
      confidence: "LOW",
      outsideNotes: true,
      unsupported: true,
    },
    mastery: { state: "PRACTICE", score: 0.15 },
  },
] satisfies Schemas["AnswerResult"][];
