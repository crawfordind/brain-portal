/**
 * Import boundaries that make three guarantees structural rather than a
 * matter of care:
 *
 *  1. Only the OpenRouter adapter (`runtime/openrouter.ts`) on the delegated-
 *     task path can reach OpenRouter. The dispatcher reaches that adapter only
 *     when `AGENT_RUNTIME=openrouter`, so a Hermes deployment cannot spend
 *     OpenRouter credits by way of a stray import.
 *  2. The OpenRouter adapter never imports the Hermes client, and vice versa.
 *  3. No browser code can import the modules that hold the runtime's URL and
 *     keys (type-only imports are erased at build time and allowed).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const OPENROUTER_MODULES = [
  "@/lib/ai/client",
  "@/lib/ai/embeddings",
  "@/lib/ai/models",
  "@/lib/ai/tiers",
  "openai",
];

const TASK_PATH = [
  ...walk(join(ROOT, "src/lib/agents")),
  ...walk(join(ROOT, "src/app/api/agent-tasks")),
  ...walk(join(ROOT, "src/app/api/agent-runtime")),
  join(ROOT, "src/app/api/cron/process-agent-queue/route.ts"),
];

const OPENROUTER_ADAPTER = join(ROOT, "src/lib/agents/runtime/openrouter.ts");
const HERMES_CLIENT = join(ROOT, "src/lib/agents/runtime/hermes-client.ts");

/** Module specifiers a file loads at runtime. `import type` is erased, so it is skipped. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8").replace(/^\s*import\s+type\s[^;]*;/gm, "");
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("import boundaries", () => {
  it("only the OpenRouter adapter on the delegated-task path imports OpenRouter code", () => {
    expect(TASK_PATH).toContain(OPENROUTER_ADAPTER);
    const offenders = TASK_PATH.filter((file) => file !== OPENROUTER_ADAPTER).flatMap((file) =>
      importsOf(file)
        .filter((spec) => OPENROUTER_MODULES.some((m) => spec === m || spec.startsWith(`${m}/`)))
        .map((spec) => `${relative(ROOT, file)} → ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  it("the two runtime adapters do not import each other", () => {
    expect(importsOf(OPENROUTER_ADAPTER).filter((s) => /hermes/.test(s))).toEqual([]);
    expect(importsOf(HERMES_CLIENT).filter((s) => /openrouter|@\/lib\/ai\//.test(s))).toEqual([]);
  });

  it("the old executor and its context builder are gone, replaced by the adapter", () => {
    const files = walk(join(ROOT, "src")).map((f) => relative(ROOT, f));
    expect(files).not.toContain("src/lib/agents/executor.ts");
    expect(files).not.toContain("src/lib/agents/context.ts");
    const callers = walk(join(ROOT, "src")).filter((f) => /executeAgentTask/.test(readFileSync(f, "utf8")));
    expect(callers.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("no client component imports the server-only runtime modules", () => {
    const serverOnly = ["@/lib/agents/runtime/config", "@/lib/agents/runtime/hermes-client", "@/lib/agents/runtime/openrouter", "@/lib/agents/runtime/dispatcher", "@/lib/agents/runtime/http", "@/lib/agents/runtime/guard", "@/lib/agents/runtime/schema"];
    const clientFiles = walk(join(ROOT, "src")).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    const offenders = clientFiles.flatMap((file) =>
      importsOf(file).filter((spec) => serverOnly.includes(spec)).map((spec) => `${relative(ROOT, file)} → ${spec}`)
    );
    expect(clientFiles.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("the runtime's endpoint and keys are read only from server environment, never NEXT_PUBLIC_", () => {
    const leaks = walk(join(ROOT, "src")).filter((f) => /NEXT_PUBLIC_(HERMES|AGENT_RUNTIME)/.test(readFileSync(f, "utf8")));
    expect(leaks).toEqual([]);
  });
});
