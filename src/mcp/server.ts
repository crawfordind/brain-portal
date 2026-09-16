#!/usr/bin/env node
/**
 * Brain Portal MCP Server
 *
 * A full-featured Model Context Protocol server that exposes Brain Portal's
 * knowledge management, task management, AI delegation, and insight
 * generation capabilities to Claude Code and other MCP clients.
 *
 * Configuration is read from the project's `.env` / `.env.local` files at
 * startup (see `./load-env`), so the MCP client config does NOT need to carry
 * any secrets. Required: TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) for the
 * database, and MCP_API_KEY (or MCP_USER_ID for trusted dev) for auth.
 * OPENROUTER_API_KEY is optional — only the AI tools (semantic_search,
 * generate_insights, delegate_to_agent) use it; the other ~18 tools work
 * without it.
 *
 * Usage:
 *   # Secrets come from .env / .env.local in the project root
 *   npx tsx src/mcp/server.ts
 *
 *   # Or override any value inline
 *   MCP_API_KEY=bp_mcp_... npx tsx src/mcp/server.ts
 *
 * Claude Desktop config (claude_desktop_config.json) — no secrets needed:
 *   {
 *     "mcpServers": {
 *       "brain-portal": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/brain-portal/src/mcp/server.ts"],
 *         "cwd": "/path/to/brain-portal"
 *       }
 *     }
 *   }
 */

// Load .env / .env.local before anything reads process.env, so secrets can
// live in the project's env files instead of the MCP client config.
import "./load-env";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { authenticateFromEnv, type AuthenticatedUser } from "./auth";
import { createToolContext } from "./guard";

// Tool registrations
import { registerAllTools, TOOL_MODULES } from "./tools/index";

// Resource registrations
import { registerResources } from "./resources/index";

// Prompt registrations
import { registerPrompts } from "./prompts/index";

// ─── Server Initialization ──────────────────────────────

let authenticatedUser: AuthenticatedUser | null = null;

function getUser(): AuthenticatedUser {
  if (!authenticatedUser) {
    throw new Error("Not authenticated. Server failed to initialize.");
  }
  return authenticatedUser;
}

async function main() {
  // Authenticate before starting the server
  try {
    authenticatedUser = await authenticateFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Brain Portal MCP] Authentication failed: ${message}`);
    process.exit(1);
  }

  console.error(
    `[Brain Portal MCP] Authenticated as user ${authenticatedUser.userId} ` +
    `(key: ${authenticatedUser.keyName})`
  );

  // Create server
  const server = new McpServer({
    name: "brain-portal",
    version: "1.0.0",
  });

  // Build a tool context that carries scope + rate-limit enforcement.
  const ctx = createToolContext(getUser);

  // Register all tools
  registerAllTools(server, ctx);

  // Register resources
  registerResources(server, ctx);

  // Register prompts
  registerPrompts(server, ctx);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[Brain Portal MCP] Server started successfully.");
  console.error(
    `[Brain Portal MCP] Tool modules: ${TOOL_MODULES.map((m) => m.name).join(", ")}`
  );
  console.error(
    `[Brain Portal MCP] Resources: 7 | Prompts: 4`
  );
}

main().catch((error) => {
  console.error("[Brain Portal MCP] Fatal error:", error);
  process.exit(1);
});
