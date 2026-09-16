/**
 * Environment loader for the standalone MCP server.
 *
 * The stdio MCP server (`src/mcp/server.ts`) runs *outside* Next.js, so
 * unlike the app it does not get `.env` / `.env.local` loaded for it. Rather
 * than forcing every secret (Turso, OpenRouter, the MCP key) to be duplicated
 * into the Claude Desktop / Claude Code config's `env` block, we load the
 * project's env files here at process start.
 *
 * This module is imported *first* by `server.ts` (before any module that reads
 * `process.env`), so every downstream lookup sees the loaded values.
 *
 * Precedence (highest first):
 *   1. Variables already in `process.env` (e.g. passed via the client config)
 *   2. `.env.local`
 *   3. `.env`
 *
 * `dotenv` never overwrites a variable that is already set, so loading
 * `.env.local` before `.env` gives `.env.local` priority, and anything the
 * launcher already exported wins over both.
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Project root is two levels up from this file (src/mcp/ -> project root),
// resolved relative to the module itself so it works regardless of the
// process working directory the MCP client happens to launch us with.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, "..", "..");

loadEnv({ path: resolve(projectRoot, ".env.local") });
loadEnv({ path: resolve(projectRoot, ".env") });
