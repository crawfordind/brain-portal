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
import { findTool, isReadOnlyTool } from "@/lib/mcp/catalog";

import { registerNoteTools } from "./notes";
import { registerTaskTools } from "./tasks";
import { registerProjectTools } from "./projects";
import { registerCaptureTools } from "./captures";
import { registerAITools } from "./ai";
import { registerSearchTools } from "./search";
import { registerCrmTools } from "./crm";
import { registerOperationsTools } from "./operations";

export const TOOL_MODULES = [
  { name: "notes", register: registerNoteTools },
  { name: "tasks", register: registerTaskTools },
  { name: "projects", register: registerProjectTools },
  { name: "captures", register: registerCaptureTools },
  { name: "ai", register: registerAITools },
  { name: "search", register: registerSearchTools },
  { name: "crm", register: registerCrmTools },
  { name: "operations", register: registerOperationsTools },
] as const;

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  const annotating = withReadOnlyHints(server);
  for (const { register } of TOOL_MODULES) {
    register(annotating, ctx);
  }
}

/**
 * Mark every read-only tool `readOnlyHint: true` as it is registered, from the
 * catalog, so no module has to remember to. An agent host that gates
 * write-capable tools (Hermes `trust: untrusted`) then asks the user before
 * writes and lets reads through. The hint never grants access; scopes do.
 */
function withReadOnlyHints(server: McpServer): McpServer {
  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== "tool") return Reflect.get(target, prop, receiver);
      return (...args: unknown[]) => {
        const registered = (target.tool as (...a: unknown[]) => unknown).apply(target, args) as
          | { update?: (u: { annotations: { readOnlyHint: boolean } }) => void }
          | undefined;
        const spec = typeof args[0] === "string" ? findTool(args[0]) : undefined;
        if (spec && isReadOnlyTool(spec)) registered?.update?.({ annotations: { readOnlyHint: true } });
        return registered;
      };
    },
  });
}
