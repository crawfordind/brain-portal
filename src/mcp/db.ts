/**
 * MCP Server Database Client
 *
 * Delegates to the shared client in `@/lib/db/client` rather than opening a
 * second connection. The MCP process already loads that module transitively —
 * the CRM tools reuse `src/lib/crm/*`, which imports it — so keeping a separate
 * client here would mean two connections to the same database and two lazy
 * initializations racing on the same env vars.
 *
 * CONSTRAINT: `@/lib/db/client` must stay free of Next.js imports. It is a bare
 * libsql client today, and the MCP server runs outside Next, so anything
 * Next-specific added there would break `npm run mcp:start`.
 *
 * The exported surface is unchanged, including `db.execute(sql, args)` in its
 * positional form, so existing tools need no edits. The shared client's
 * `db.execute` takes an object instead; both spellings are supported below.
 *
 * Every export stays `async` so a missing configuration REJECTS rather than
 * throwing synchronously. Callers written against the previous async functions
 * catch it with `.catch()` or `await`, and would miss a synchronous throw.
 */

import type { InValue, ResultSet } from "@libsql/client";
import {
  db as sharedDb,
  query as sharedQuery,
  queryOne as sharedQueryOne,
  mutate as sharedMutate,
} from "@/lib/db/client";

/**
 * Fail with the MCP-specific message rather than the shared client's generic
 * one. An operator hitting this is starting `npm run mcp:start`, not running
 * the web app, and needs to be told to pass the variable to the server process.
 */
function assertConfigured(): void {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. " +
        "Pass it as an environment variable when starting the MCP server."
    );
  }
}

export const db = {
  /**
   * Accepts either `execute(sql, args)` (this module's historical shape, used
   * by the existing MCP tools) or `execute({ sql, args })` (the shared
   * client's shape, used by anything imported from `src/lib`).
   */
  async execute(
    sqlOrStatement: string | { sql: string; args?: InValue[] },
    args: InValue[] = []
  ): Promise<ResultSet> {
    assertConfigured();
    if (typeof sqlOrStatement === "string") {
      return sharedDb.execute({ sql: sqlOrStatement, args });
    }
    return sharedDb.execute({
      sql: sqlOrStatement.sql,
      args: sqlOrStatement.args ?? [],
    });
  },
};

export async function query<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  assertConfigured();
  return sharedQuery<T>(sql, args);
}

export async function queryOne<T>(
  sql: string,
  args: InValue[] = []
): Promise<T | null> {
  assertConfigured();
  return sharedQueryOne<T>(sql, args);
}

export async function mutate<T>(
  sql: string,
  args: InValue[] = []
): Promise<T | null> {
  assertConfigured();
  return sharedMutate<T>(sql, args);
}
