import { vi } from "vitest";

/**
 * A complete mock of `@/lib/db/client`.
 *
 * Each test used to hand-roll a partial mock declaring only the exports it
 * expected the route to call. That coupled every test to the route's current
 * query shape: adding a `queryOne` to a handler broke unrelated suites with
 * "No 'queryOne' export is defined on the mock", which says nothing about what
 * actually changed. Declaring the whole surface once means a test fails only
 * when its own subject misbehaves.
 *
 * Override individual members by spreading:
 *
 *   vi.mock("@/lib/db/client", async () => ({
 *     ...(await import("../helpers/db-mock")).createDbClientMock(),
 *     queryAll: vi.fn().mockResolvedValue([{ id: "1" }]),
 *   }));
 */
export function createDbClientMock() {
  return {
    db: {
      execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
      batch: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    },
    query: vi.fn().mockResolvedValue([]),
    queryAll: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    mutate: vi.fn().mockResolvedValue(null),
  };
}
