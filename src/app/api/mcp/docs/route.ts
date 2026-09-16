/**
 * GET /api/mcp/docs
 *
 * Public, unauthenticated documentation endpoint that describes every
 * tool, resource, prompt, and scope exposed by the Brain Portal MCP
 * server. Designed so an LLM can fetch this once and learn the entire
 * surface area without prior knowledge.
 *
 * Query params:
 *   ?format=json     (default) — machine-readable catalog with JSON Schema
 *                                 input definitions for each tool/prompt
 *   ?format=openapi  — OpenAPI 3.1.0 spec covering the HTTP transport
 *                      (POST /api/mcp/rpc) and the keys management routes
 *   ?format=markdown — human-readable docs (also great for embedding in
 *                      LLM system prompts)
 *
 * Why this exists: external agents authenticate via API key and call
 * `/api/mcp/rpc` with JSON-RPC. Discovering the available tools /
 * resources / prompts via `tools/list` etc. is possible but verbose —
 * this single GET returns the full spec in one shot.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  TOOLS,
  RESOURCES,
  PROMPTS,
  type ToolSpec,
  type PromptSpec,
} from "@/lib/mcp/catalog";
import { MCP_SCOPES } from "@/lib/mcp/keys";

export const runtime = "nodejs";

// Cache the docs aggressively — the catalog is static per-deploy.
const CACHE_HEADER = "public, max-age=300, s-maxage=300";
const SPEC_VERSION = "1.0.0";

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

function schemaFor(zodSchema: z.ZodObject<z.ZodRawShape>): JsonSchemaObject {
  // Zod 4 has a built-in JSON Schema serializer.
  return z.toJSONSchema(zodSchema, { target: "draft-7" }) as JsonSchemaObject;
}

function toolEntry(t: ToolSpec) {
  return {
    name: t.name,
    description: t.description,
    category: t.category,
    required_scope: t.scope,
    input_schema: schemaFor(t.inputSchema),
    ...(t.example ? { example: t.example } : {}),
  };
}

function promptEntry(p: PromptSpec) {
  return {
    name: p.name,
    description: p.description,
    required_scope: p.scope,
    input_schema: schemaFor(p.inputSchema),
  };
}

// ─── JSON catalog ─────────────────────────────────────────────────────

function buildJsonSpec(baseUrl: string) {
  return {
    spec_version: SPEC_VERSION,
    name: "brain-portal",
    description:
      "Brain Portal MCP server — knowledge management, task management, AI agents, and insight generation.",
    transports: {
      stdio: {
        command: "npx tsx /path/to/brain-portal/src/mcp/server.ts",
        env: ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "MCP_API_KEY"],
        notes:
          "Local subprocess transport. Configure via Claude Code's mcpServers config.",
      },
      http: {
        endpoint: `${baseUrl}/api/mcp/rpc`,
        endpoint_with_key: `${baseUrl}/api/mcp/rpc/bp_mcp_...`,
        protocol: "MCP Streamable HTTP (JSON-RPC 2.0)",
        auth_header: "Authorization: Bearer bp_mcp_...",
        methods: ["POST", "GET", "DELETE"],
        notes:
          "Stateless. POST for JSON-RPC requests, GET for SSE stream, DELETE to terminate session. " +
          "Clients that cannot set headers (e.g. the Claude.ai custom-connector form) may put the key " +
          "in the URL path instead.",
      },
    },
    authentication: {
      type: "api_key",
      header: "Authorization",
      scheme: "Bearer",
      key_format: "bp_mcp_<64 hex chars>",
      alternatives: [
        `Path: POST ${baseUrl}/api/mcp/rpc/bp_mcp_...`,
        `Query: POST ${baseUrl}/api/mcp/rpc?key=bp_mcp_...`,
      ],
      alternatives_notes:
        "URL-borne keys are for clients that cannot send headers. They appear in proxy logs — " +
        "use a dedicated, narrowly-scoped, expiring key.",
      issuance: `Generate via Settings → "AI API access" or POST ${baseUrl}/api/mcp/keys (cookie-authed)`,
      management_endpoints: {
        list: `GET ${baseUrl}/api/mcp/keys`,
        create: `POST ${baseUrl}/api/mcp/keys`,
        revoke: `DELETE ${baseUrl}/api/mcp/keys/{id}`,
      },
    },
    scopes: MCP_SCOPES.map((scope) => ({
      scope,
      description: scopeDescription(scope),
    })),
    rate_limiting: {
      algorithm: "token_bucket",
      bucket_size_tokens: "rate_limit_per_minute (per key)",
      refill_rate: "rate_limit_per_minute / 60_000 tokens per ms",
      default_per_minute: 60,
      headers_on_429: ["retry_after_ms"],
      notes:
        "Scope-denied calls do NOT consume a token. Limiter is per-process.",
    },
    error_format: {
      shape: {
        error: "scope | rate_limit | unauthorized | server_error | ...",
        message: "string",
        scope: "(scope errors only) the missing scope",
        retry_after_ms: "(rate-limit errors only) ms until next token",
      },
    },
    tools: TOOLS.map(toolEntry),
    resources: RESOURCES.map((r) => ({
      uri: r.uri,
      description: r.description,
      required_scope: r.scope,
      template: Boolean(r.template),
    })),
    prompts: PROMPTS.map(promptEntry),
    counts: {
      tools: TOOLS.length,
      resources: RESOURCES.length,
      prompts: PROMPTS.length,
      scopes: MCP_SCOPES.length,
    },
  };
}

function scopeDescription(scope: string): string {
  const map: Record<string, string> = {
    "notes:read": "List, read, and search notes.",
    "notes:write": "Create, update, archive, and delete notes.",
    "tasks:read": "List and filter tasks.",
    "tasks:write": "Create, update, and delete tasks.",
    "projects:read": "List and read projects.",
    "projects:write": "Create and update projects.",
    "captures:read": "List captures.",
    "captures:write": "Create captures.",
    "search:read": "Full-text search and recent activity feed.",
    "ai:search": "Embedding-based semantic search (incurs embedding cost).",
    "ai:insights": "Generate AI insights from notes/captures (LLM cost).",
    "ai:delegate":
      "Delegate work to AI agents and read agent task status.",
    "resources:read": "Read brain://* resources.",
    "prompts:read": "Use templated prompts (summarize_notes, weekly_review, ...).",
  };
  return map[scope] ?? "";
}

// ─── OpenAPI 3.1 spec ─────────────────────────────────────────────────

function buildOpenApiSpec(baseUrl: string) {
  // Group tools into per-tool POST endpoints under /api/mcp/rpc using the
  // JSON-RPC envelope. We expose the JSON-RPC contract as one operation
  // and then list each tool as a separately-documented schema.
  return {
    openapi: "3.1.0",
    info: {
      title: "Brain Portal MCP API",
      version: SPEC_VERSION,
      description:
        "Model Context Protocol over HTTP. All tool calls are sent as JSON-RPC 2.0 messages to /api/mcp/rpc.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "bp_mcp_*",
          description: "MCP API key issued from Settings → AI API access.",
        },
      },
      schemas: {
        JsonRpcRequest: {
          type: "object",
          required: ["jsonrpc", "method", "id"],
          properties: {
            jsonrpc: { const: "2.0" },
            method: {
              type: "string",
              enum: [
                "initialize",
                "tools/list",
                "tools/call",
                "resources/list",
                "resources/read",
                "prompts/list",
                "prompts/get",
              ],
            },
            id: {
              oneOf: [{ type: "string" }, { type: "number" }],
            },
            params: { type: "object" },
          },
        },
        JsonRpcResponse: {
          type: "object",
          required: ["jsonrpc", "id"],
          properties: {
            jsonrpc: { const: "2.0" },
            id: { oneOf: [{ type: "string" }, { type: "number" }] },
            result: {},
            error: {
              type: "object",
              properties: {
                code: { type: "integer" },
                message: { type: "string" },
                data: {},
              },
            },
          },
        },
        // Per-tool input schemas, namespaced.
        ...Object.fromEntries(
          TOOLS.map((t) => [
            `Tool_${t.name}_Input`,
            schemaFor(t.inputSchema),
          ])
        ),
      },
    },
    security: [{ bearer: [] }],
    paths: {
      "/api/mcp/rpc": {
        post: {
          summary: "Send an MCP JSON-RPC request",
          description: [
            "All MCP operations flow through this single endpoint.",
            "Use `method: \"tools/call\"` with `params: { name, arguments }` to invoke a tool.",
            "Each tool's argument schema is documented under `components.schemas.Tool_<name>_Input`.",
          ].join("\n\n"),
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/JsonRpcRequest" },
                examples: Object.fromEntries(
                  TOOLS.filter((t) => t.example).map((t) => [
                    t.name,
                    {
                      summary: `Call ${t.name}`,
                      value: {
                        jsonrpc: "2.0",
                        id: 1,
                        method: "tools/call",
                        params: {
                          name: t.name,
                          arguments: t.example,
                        },
                      },
                    },
                  ])
                ),
              },
            },
          },
          responses: {
            "200": {
              description: "JSON-RPC response.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/JsonRpcResponse" },
                },
              },
            },
            "401": { description: "Missing or invalid API key." },
          },
        },
        get: {
          summary: "Open an SSE stream for server-initiated messages",
          responses: {
            "200": {
              description: "text/event-stream with JSON-RPC messages.",
            },
          },
        },
      },
      "/api/mcp/keys": {
        get: {
          summary: "List the current user's MCP API keys (cookie auth)",
          security: [],
          responses: { "200": { description: "OK" } },
        },
        post: {
          summary: "Create an MCP API key (cookie auth)",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    scopes: {
                      type: "array",
                      items: { type: "string", enum: [...MCP_SCOPES, "*"] },
                    },
                    rate_limit_per_minute: {
                      type: "integer",
                      minimum: 1,
                      maximum: 10000,
                    },
                    expires_in_days: {
                      type: "integer",
                      minimum: 1,
                      maximum: 1825,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Returns `{ key, summary }`. The plaintext `key` is shown only here.",
            },
          },
        },
      },
      "/api/mcp/keys/{id}": {
        delete: {
          summary: "Revoke a key by id (cookie auth)",
          security: [],
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Revoked" } },
        },
      },
      "/api/mcp/docs": {
        get: {
          summary: "This endpoint",
          security: [],
          parameters: [
            {
              in: "query",
              name: "format",
              schema: { type: "string", enum: ["json", "openapi", "markdown"] },
            },
          ],
          responses: { "200": { description: "Spec." } },
        },
      },
    },
    "x-tools": TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      required_scope: t.scope,
      input_schema_ref: `#/components/schemas/Tool_${t.name}_Input`,
    })),
    "x-resources": RESOURCES,
    "x-prompts": PROMPTS.map((p) => ({
      name: p.name,
      description: p.description,
      required_scope: p.scope,
      input_schema: schemaFor(p.inputSchema),
    })),
  };
}

// ─── Markdown ─────────────────────────────────────────────────────────

function buildMarkdown(baseUrl: string): string {
  const lines: string[] = [];
  lines.push(`# Brain Portal MCP — API Reference`);
  lines.push("");
  lines.push(`Version: \`${SPEC_VERSION}\``);
  lines.push("");
  lines.push(
    `Brain Portal exposes notes, tasks, projects, captures, AI search, and an agent delegation system over the Model Context Protocol. Connect via stdio (local) or HTTP at \`${baseUrl}/api/mcp/rpc\`.`
  );
  lines.push("");

  lines.push(`## Authentication`);
  lines.push("");
  lines.push(
    `Send \`Authorization: Bearer bp_mcp_...\` on every request. Generate keys at Settings → "AI API access".`
  );
  lines.push("");
  lines.push(
    `Clients that cannot set request headers — such as the Claude.ai custom-connector form, which offers only OAuth fields — can carry the key in the URL instead: \`${baseUrl}/api/mcp/rpc/bp_mcp_...\` (or \`?key=bp_mcp_...\`). URL-borne keys land in proxy access logs, so issue a dedicated, narrowly-scoped, expiring key for that use.`
  );
  lines.push("");
  lines.push(`Endpoints for key management (cookie-authed):`);
  lines.push(`- \`GET ${baseUrl}/api/mcp/keys\``);
  lines.push(`- \`POST ${baseUrl}/api/mcp/keys\``);
  lines.push(`- \`DELETE ${baseUrl}/api/mcp/keys/{id}\``);
  lines.push("");

  lines.push(`## Scopes`);
  lines.push("");
  lines.push(`| Scope | Description |`);
  lines.push(`|---|---|`);
  for (const s of MCP_SCOPES) {
    lines.push(`| \`${s}\` | ${scopeDescription(s)} |`);
  }
  lines.push(`| \`*\` | Wildcard — grants every scope. |`);
  lines.push("");
  lines.push(
    `> Scope-denied calls do NOT consume a rate-limit token. Default rate limit is 60 calls/minute per key.`
  );
  lines.push("");

  lines.push(`## Tools (${TOOLS.length})`);
  lines.push("");
  lines.push(
    `Invoke via JSON-RPC: \`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<tool>","arguments":{...}}}\``
  );
  lines.push("");
  const byCategory = new Map<string, ToolSpec[]>();
  for (const t of TOOLS) {
    const list = byCategory.get(t.category) ?? [];
    list.push(t);
    byCategory.set(t.category, list);
  }
  for (const [cat, tools] of byCategory) {
    lines.push(`### ${cat}`);
    lines.push("");
    for (const t of tools) {
      lines.push(`#### \`${t.name}\``);
      lines.push("");
      lines.push(`${t.description}`);
      lines.push("");
      lines.push(`**Required scope:** \`${t.scope}\``);
      lines.push("");
      const schema = schemaFor(t.inputSchema);
      lines.push("**Input schema:**");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(schema, null, 2));
      lines.push("```");
      if (t.example) {
        lines.push("");
        lines.push("**Example call:**");
        lines.push("");
        lines.push("```json");
        lines.push(
          JSON.stringify(
            {
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: t.name, arguments: t.example },
            },
            null,
            2
          )
        );
        lines.push("```");
      }
      lines.push("");
    }
  }

  lines.push(`## Resources (${RESOURCES.length})`);
  lines.push("");
  lines.push(
    `Read with JSON-RPC: \`{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"<uri>"}}\``
  );
  lines.push("");
  lines.push(`| URI | Required scope | Description |`);
  lines.push(`|---|---|---|`);
  for (const r of RESOURCES) {
    lines.push(`| \`${r.uri}\` | \`${r.scope}\` | ${r.description} |`);
  }
  lines.push("");

  lines.push(`## Prompts (${PROMPTS.length})`);
  lines.push("");
  for (const p of PROMPTS) {
    lines.push(`### \`${p.name}\``);
    lines.push("");
    lines.push(`${p.description}`);
    lines.push("");
    lines.push(`**Required scope:** \`${p.scope}\``);
    lines.push("");
    lines.push("**Input schema:**");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(schemaFor(p.inputSchema), null, 2));
    lines.push("```");
    lines.push("");
  }

  lines.push(`## Errors`);
  lines.push("");
  lines.push(
    `Tool errors arrive in the JSON-RPC response's \`result\` with \`isError: true\` and a JSON body in \`content[0].text\`:`
  );
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        error: "scope | rate_limit | ...",
        message: "human-readable explanation",
        scope: "(scope errors) missing scope",
        retry_after_ms: "(rate_limit errors) ms until next token",
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

// ─── Handler ──────────────────────────────────────────────────────────

function getBaseUrl(req: NextRequest): string {
  // Prefer the public env URL, fall back to the request origin.
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: NextRequest) {
  const format = (
    new URL(request.url).searchParams.get("format") ?? "json"
  ).toLowerCase();
  const baseUrl = getBaseUrl(request);

  try {
    if (format === "openapi") {
      const spec = buildOpenApiSpec(baseUrl);
      return NextResponse.json(spec, {
        headers: { "cache-control": CACHE_HEADER },
      });
    }
    if (format === "markdown" || format === "md") {
      const markdown = buildMarkdown(baseUrl);
      return new NextResponse(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "cache-control": CACHE_HEADER,
        },
      });
    }
    if (format !== "json") {
      return NextResponse.json(
        {
          error: "invalid_format",
          message: `Unknown format "${format}". Use one of: json, openapi, markdown.`,
        },
        { status: 400 }
      );
    }
    const spec = buildJsonSpec(baseUrl);
    return NextResponse.json(spec, {
      headers: { "cache-control": CACHE_HEADER },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mcp/docs] failed to build spec:", err);
    return NextResponse.json(
      { error: "server_error", message },
      { status: 500 }
    );
  }
}
