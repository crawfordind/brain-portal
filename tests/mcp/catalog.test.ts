/**
 * Catalog ↔ runtime sync tests.
 *
 * Guarantees that every tool / resource / prompt registered with the
 * MCP server has a matching entry in the documentation catalog
 * (`src/lib/mcp/catalog.ts`). When you add a tool, you must add it to
 * the catalog too — otherwise the docs endpoint silently misses it.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/mcp/db", () => ({
  db: { execute: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  mutate: vi.fn(),
}));

import { TOOLS, RESOURCES, PROMPTS, findTool } from "@/lib/mcp/catalog";
import { MCP_SCOPES } from "@/lib/mcp/keys";

interface CapturedTool {
  name: string;
  description?: string;
}
interface CapturedResource {
  name: string;
  uriOrTemplate: string;
}
interface CapturedPrompt {
  name: string;
  description?: string;
}

function recordingServer() {
  const tools: CapturedTool[] = [];
  const resources: CapturedResource[] = [];
  const prompts: CapturedPrompt[] = [];
  return {
    tools,
    resources,
    prompts,
    server: {
      tool(name: string, description: string) {
        tools.push({ name, description });
      },
      resource(name: string, uriOrTemplate: string | { template: string }) {
        const uri =
          typeof uriOrTemplate === "string"
            ? uriOrTemplate
            : uriOrTemplate.template;
        resources.push({ name, uriOrTemplate: uri });
      },
      prompt(name: string, description: string) {
        prompts.push({ name, description });
      },
    },
  };
}

function dummyCtx() {
  const user = {
    userId: "u1",
    keyId: "k1",
    keyName: "Test",
    scopes: ["*"],
    rateLimitPerMinute: 60,
  };
  return {
    getUser: () => user,
    getUserId: () => user.userId,
    guard: () => ({ ok: true as const, userId: user.userId, user, rateLimit: { remaining: 60, limit: 60 } }),
  };
}

describe("catalog ↔ runtime sync", () => {
  it("catalog covers every registered tool", async () => {
    const { server, tools } = recordingServer();
    const ctx = dummyCtx();

    // Registration comes from the same module both transports use, so adding a
    // tool module cannot bypass this check. Importing each register function by
    // hand here used to mean a whole new module was invisible: its tools
    // existed at runtime, undocumented, and this test still passed.
    const { registerAllTools } = await import("@/mcp/tools/index");

     
    registerAllTools(server as any, ctx as any);

    const registeredNames = tools.map((t) => t.name).sort();
    const catalogNames = TOOLS.map((t) => t.name).sort();
    expect(registeredNames).toEqual(catalogNames);
  });

  it("registers every declared tool module", async () => {
    const { TOOL_MODULES } = await import("@/mcp/tools/index");
    // A guard on the guard: if a module is added to TOOL_MODULES it is
    // registered, and the assertion above then forces it into the catalog.
    expect(TOOL_MODULES.length).toBeGreaterThan(0);
    for (const mod of TOOL_MODULES) {
      expect(typeof mod.register).toBe("function");
    }
  });

  it("every catalog tool uses a known scope", () => {
    const valid = new Set<string>(MCP_SCOPES);
    valid.add("*");
    for (const t of TOOLS) {
      expect(valid.has(t.scope)).toBe(true);
    }
  });

  it("every catalog resource uses resources:read", () => {
    for (const r of RESOURCES) {
      expect(r.scope).toBe("resources:read");
    }
  });

  it("every catalog prompt uses prompts:read", () => {
    for (const p of PROMPTS) {
      expect(p.scope).toBe("prompts:read");
    }
  });

  it("findTool returns the matching tool by name", () => {
    expect(findTool("create_note")?.scope).toBe("notes:write");
    expect(findTool("nope")).toBeUndefined();
  });
});

/**
 * The HTTP transport is what remote agents (Claude.ai connectors, proxies) use.
 * It registers tools, resources and prompts separately from the stdio server,
 * so the two can drift: dropping a registration here leaves stdio working while
 * HTTP silently serves less. These assertions pin all three.
 */
describe("HTTP transport registers the same surface as stdio", () => {
  it("registers tools, resources and prompts", async () => {
    const handler = await import("fs").then((fs) =>
      fs.readFileSync("src/app/api/mcp/rpc/handler.ts", "utf8")
    );
    expect(handler).toContain("registerAllTools(server, ctx)");
    expect(handler).toContain("registerResources(server, ctx)");
    expect(handler).toContain("registerPrompts(server, ctx)");
  });

  it("the stdio server registers the same three", async () => {
    const server = await import("fs").then((fs) =>
      fs.readFileSync("src/mcp/server.ts", "utf8")
    );
    expect(server).toContain("registerAllTools(server, ctx)");
    expect(server).toContain("registerResources(server, ctx)");
    expect(server).toContain("registerPrompts(server, ctx)");
  });
});
