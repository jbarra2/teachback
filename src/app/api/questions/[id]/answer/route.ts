import { AiError } from "@/lib/ai/errors";
import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { AnswerBody, IdParams } from "@/lib/schemas";
import { answerQuestion } from "@/lib/services/answer";

/**
 * POST /api/questions/{id}/answer: grade my answer to one of my questions against my notes. Every
 * quote in the feedback has been checked against the notes. An AI failure is a 502 with a friendly,
 * fixed message, and no Attempt is saved.
 */
export const POST = withApi<{ id: string }>(
  async ({ user, params, json }) => {
    const { id } = IdParams.parse(params);
    const { answer } = AnswerBody.parse(await json());
    try {
      const result = await answerQuestion(user.id, id, answer);
      if (!result) throw new ApiError("NOT_FOUND");
      return Response.json(result);
    } catch (error) {
      if (error instanceof AiError) throw new ApiError("AI_UNAVAILABLE");
      throw error;
    }
  },
  { rateLimit: "ai" },
);
