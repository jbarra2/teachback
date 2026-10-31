import type { NextConfig } from "next";

// cacheComponents stays off (PLAN §3), so partialPrefetching (which needs it) is off too.
const nextConfig: NextConfig = {
  // `next dev` would otherwise write AGENTS.md into the repo when it detects an AI agent.
  // CLAUDE.md is the one place for agent instructions.
  agentRules: false,
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
