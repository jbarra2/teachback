import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/api/security-headers";

// cacheComponents stays off (PLAN §3), so partialPrefetching (which needs it) is off too.
const nextConfig: NextConfig = {
  // No "X-Powered-By: Next.js": the app doesn't announce what it runs on.
  poweredByHeader: false,
  async headers() {
    const headers = securityHeaders().map(([key, value]) => ({ key, value }));
    // Every path, including what neither src/proxy.ts (pages) nor withApi (API routes) sees: Next's
    // static files, its 404 for an unknown /api path, and its automatic 405 and OPTIONS answers.
    // The CSP isn't here: pages need a per-request nonce, which only the proxy can make.
    return [{ source: "/:path*", headers }];
  },
  // `next dev` would otherwise write AGENTS.md into the repo when it detects an AI agent.
  // CLAUDE.md is the one place for agent instructions.
  agentRules: false,
  // GET /api/openapi reads the contract from disk, so serverless builds must ship the file.
  outputFileTracingIncludes: {
    "/api/openapi": ["./openapi/openapi.yaml"],
    "/api/documents": [
      // Node runs the PDF child script as a separate process, so it isn't in the route's bundle.
      "./src/lib/ingest/pdf-child.ts",
      // The child loads unpdf directly, so Next.js can't trace it from the route.
      "./node_modules/unpdf/**",
    ],
  },
  experimental: {
    // The dev-only MCP endpoint (/_next/mcp) answers anyone who can reach the dev server,
    // including the whole Wi-Fi when it runs with -H 0.0.0.0 for phone testing.
    mcpServer: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
