/**
 * Tests for the MCP docs endpoint (/api/mcp/docs).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({
  db: { execute: vi.fn() },
  query: vi.fn(),
  queryOne: vi.fn(),
  mutate: vi.fn(),
}));

import { GET } from "@/app/api/mcp/docs/route";
import { TOOLS, RESOURCES, PROMPTS } from "@/lib/mcp/catalog";

function makeRequest(query = ""): import("next/server").NextRequest {
  const url = `https://app.example.com/api/mcp/docs${query}`;
  return new Request(url, { method: "GET" }) as unknown as
    import("next/server").NextRequest;
}

describe("/api/mcp/docs", () => {
  it("returns the JSON catalog by default", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    const body = await res.json();
    expect(body.spec_version).toBeDefined();
    expect(body.name).toBe("brain-portal");
    expect(body.tools.length).toBe(TOOLS.length);
    expect(body.resources.length).toBe(RESOURCES.length);
    expect(body.prompts.length).toBe(PROMPTS.length);
    expect(body.transports.http.endpoint).toBe(
      "https://app.example.com/api/mcp/rpc"
    );
    expect(body.authentication.scheme).toBe("Bearer");
    expect(body.scopes.length).toBeGreaterThan(0);
  });

  it("each tool has an input_schema with type:object", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    for (const t of body.tools) {
      expect(t.input_schema.type).toBe("object");
      expect(typeof t.required_scope).toBe("string");
    }
  });

  it("?format=openapi returns a 3.1 spec with security and tool refs", async () => {
    const res = await GET(makeRequest("?format=openapi"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.components.securitySchemes.bearer.scheme).toBe("bearer");
    expect(body.paths["/api/mcp/rpc"].post).toBeDefined();
    expect(
      body.components.schemas[`Tool_${TOOLS[0].name}_Input`]
    ).toBeDefined();
    expect(body["x-tools"].length).toBe(TOOLS.length);
  });

  it("?format=markdown returns text/markdown including all tools", async () => {
    const res = await GET(makeRequest("?format=markdown"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/markdown/);
    const text = await res.text();
    expect(text).toContain("# Brain Portal MCP");
    expect(text).toContain("## Scopes");
    for (const t of TOOLS) {
      expect(text).toContain(`\`${t.name}\``);
    }
  });

  it("rejects unknown formats", async () => {
    const res = await GET(makeRequest("?format=xml"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_format");
  });
});
