import type { NextConfig } from "next";

// cacheComponents stays off (PLAN §3), so partialPrefetching (which needs it) is off too.
const nextConfig: NextConfig = {
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
