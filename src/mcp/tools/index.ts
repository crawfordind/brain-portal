/**
 * Single registration point for every MCP tool module.
 *
 * Both transports (stdio in `src/mcp/server.ts`, Streamable-HTTP in
 * `src/app/api/mcp/rpc/handler.ts`) and the catalog sync test all call
 * `registerAllTools`, so a new module is wired in one place.
 *
 * This matters because `tests/mcp/catalog.test.ts` guarantees that every
 * registered tool has a catalog entry. It previously imported each register
 * function by hand, which meant a whole new module was invisible to it: the
 * tools existed at runtime, undocumented, and the test still passed. Deriving
 * the list from here closes that hole.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../guard";

import { registerNoteTools } from "./notes";
import { registerTaskTools } from "./tasks";
import { registerProjectTools } from "./projects";
import { registerCaptureTools } from "./captures";
import { registerAITools } from "./ai";
import { registerSearchTools } from "./search";
import { registerCrmTools } from "./crm";

export const TOOL_MODULES = [
  { name: "notes", register: registerNoteTools },
  { name: "tasks", register: registerTaskTools },
  { name: "projects", register: registerProjectTools },
  { name: "captures", register: registerCaptureTools },
  { name: "ai", register: registerAITools },
  { name: "search", register: registerSearchTools },
  { name: "crm", register: registerCrmTools },
] as const;

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  for (const { register } of TOOL_MODULES) {
    register(server, ctx);
  }
}
