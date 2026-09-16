import { createClient, type Client, type InValue } from "@libsql/client";

// Lazy initialization to avoid build-time errors
let _db: Client | null = null;

function getDb(): Client {
  if (!_db) {
    if (!process.env.TURSO_DATABASE_URL) {
      throw new Error("TURSO_DATABASE_URL is not defined");
    }
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

// Export db as a proxy that lazily initializes
export const db = new Proxy({} as Client, {
  get(_, prop) {
    const client = getDb();
    const value = client[prop as keyof Client];
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});

// Helper for typed queries
export async function query<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  const result = await getDb().execute({ sql, args });
  return result.rows.map(row => ({ ...row })) as T[];
}

// Alias for query (for clarity in code)
export const queryAll = query;

// Helper for single result queries
export async function queryOne<T>(sql: string, args: InValue[] = []): Promise<T | null> {
  const results = await query<T>(sql, args);
  return results[0] ?? null;
}

// Helper for mutations that return the affected row
export async function mutate<T>(sql: string, args: InValue[] = []): Promise<T | null> {
  const result = await getDb().execute({ sql, args });
  return result.rows[0] ? ({ ...result.rows[0] } as T) : null;
}
