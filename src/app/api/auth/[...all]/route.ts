// Better Auth's endpoints, limited to the four the app uses (src/lib/api/auth-route.ts).
import { createAuthRoute } from "@/lib/api/auth-route";
import { auth } from "@/lib/auth";

export const { GET, POST } = createAuthRoute(auth);
