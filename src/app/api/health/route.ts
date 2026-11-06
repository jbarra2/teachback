import { withApi } from "@/lib/api/with-api";
import { checkHealth } from "@/lib/services/health";

// Checked on every request, never prerendered at build.
export const dynamic = "force-dynamic";

/** GET /api/health: 200 when the app and its database are up, 503 when the database isn't. */
export const GET = withApi(
  async () => {
    const { status, db } = await checkHealth();
    return Response.json({ status, db }, { status: db === "up" ? 200 : 503 });
  },
  { auth: false },
);
