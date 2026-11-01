import { z } from "zod";
import { LIMITS, text } from "./common";

/** POST /api/questions/{id}/answer */
export const AnswerBody = z.object({ answer: text(LIMITS.answer) }).strict();
