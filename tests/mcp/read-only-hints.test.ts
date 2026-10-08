/**
 * Read-only tools must say so over the wire. Hermes, with Brain Portal's MCP
 * server configured `trust: untrusted`, asks Daniel before every tool that is
 * *not* annotated `readOnlyHint: true`. Without the hint every search and
 * every get_note would stop Jack for approval; with a wrong hint a write would
 * slip through unapproved. Both directions are checked here, over a real MCP
 * client/server pair.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/mcp/db", () => ({
  db: { execute: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  mutate: vi.fn(),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerAllTools } from "@/mcp/tools";
import { TOOLS, isReadOnlyTool } from "@/lib/mcp/catalog";
import type { ToolContext } from "@/mcp/guard";

async function listTools() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerAllTools(server, { userId: "u1", keyId: "k", scopes: ["*"] } as unknown as ToolContext);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "c", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe("readOnlyHint annotations", () => {
  it("marks exactly the read-only tools, and never a write", async () => {
    const tools = await listTools();
    expect(tools.length).toBe(TOOLS.length);
    for (const tool of tools) {
      const spec = TOOLS.find((t) => t.name === tool.name)!;
      expect(tool.annotations?.readOnlyHint === true, tool.name).toBe(isReadOnlyTool(spec));
    }
  });

  it("never marks a write-scoped tool read-only", () => {
    for (const spec of TOOLS.filter((t) => /:write$|ai:insights/.test(t.scope) || t.name === "delegate_to_agent")) {
      expect(isReadOnlyTool(spec), spec.name).toBe(false);
    }
  });

  it("covers the reads Jack makes most", () => {
    for (const name of ["search", "semantic_search", "get_note", "list_tasks", "get_contact_brief", "operations_overview"]) {
      expect(isReadOnlyTool(TOOLS.find((t) => t.name === name)!), name).toBe(true);
    }
  });
});
