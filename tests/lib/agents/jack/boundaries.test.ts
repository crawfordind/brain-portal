/**
 * Import boundaries that make two guarantees structural rather than a matter
 * of care:
 *
 *  1. Nothing on the delegated-task path can reach OpenRouter. If a future
 *     change imports the OpenRouter client, embeddings or the model resolver
 *     into the Jack runtime, the agent-task routes or the task worker, this
 *     fails before it ships.
 *  2. No browser code can import the modules that hold Jack's URL and key.
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
  ...walk(join(ROOT, "src/app/api/jack")),
  join(ROOT, "src/app/api/cron/process-agent-queue/route.ts"),
];

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("import boundaries", () => {
  it("the delegated-task path imports nothing that can call OpenRouter", () => {
    const offenders = TASK_PATH.flatMap((file) =>
      importsOf(file)
        .filter((spec) => OPENROUTER_MODULES.some((m) => spec === m || spec.startsWith(`${m}/`)))
        .map((spec) => `${relative(ROOT, file)} → ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  it("the retired OpenRouter executor and its context builder are gone", () => {
    const files = walk(join(ROOT, "src")).map((f) => relative(ROOT, f));
    expect(files).not.toContain("src/lib/agents/executor.ts");
    expect(files).not.toContain("src/lib/agents/context.ts");
    const callers = walk(join(ROOT, "src")).filter((f) => /executeAgentTask/.test(readFileSync(f, "utf8")));
    expect(callers.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it("no client component imports the server-only Jack modules", () => {
    const serverOnly = ["@/lib/agents/jack/config", "@/lib/agents/jack/client", "@/lib/agents/jack/dispatcher", "@/lib/agents/jack/http", "@/lib/agents/jack/guard", "@/lib/agents/jack/schema"];
    const clientFiles = walk(join(ROOT, "src")).filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    const offenders = clientFiles.flatMap((file) =>
      importsOf(file).filter((spec) => serverOnly.includes(spec)).map((spec) => `${relative(ROOT, file)} → ${spec}`)
    );
    expect(clientFiles.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it("Jack's endpoint and key are read only from server environment, never NEXT_PUBLIC_", () => {
    const leaks = walk(join(ROOT, "src")).filter((f) => /NEXT_PUBLIC_JACK|NEXT_PUBLIC_HERMES/.test(readFileSync(f, "utf8")));
    expect(leaks).toEqual([]);
  });
});
