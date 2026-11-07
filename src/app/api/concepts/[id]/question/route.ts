import { AiError } from "@/lib/ai/errors";
import { ApiError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/with-api";
import { IdParams } from "@/lib/schemas";
import { createQuestion } from "@/lib/services/questions";

/**
 * POST /api/concepts/{id}/question: a new question about one of my concepts, answerable from its
 * notes. Takes no body. An AI failure is a 502 with a friendly, fixed message.
 */
export const POST = withApi<{ id: string }>(
  async ({ user, params }) => {
    const { id } = IdParams.parse(params);
    try {
      const question = await createQuestion(user.id, id);
      if (!question) throw new ApiError("NOT_FOUND");
      return Response.json(question);
    } catch (error) {
      if (error instanceof AiError) throw new ApiError("AI_UNAVAILABLE");
      throw error;
    }
  },
  { rateLimit: "ai" },
);
