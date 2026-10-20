/**
 * The account an AI call is being made for, when the call site cannot say.
 *
 * Request handlers pass `userId` explicitly. Background work (the processing
 * queue, the sweeper, skills, heartbeat, delegated tasks) runs many accounts'
 * jobs in one process, deep below functions that never took a user id; it
 * wraps each job in `runWithAiUser` so whatever that job calls bills the
 * job's owner, not whoever ran last.
 *
 * `run`, never `enterWith`: a scope that ends with the callback cannot leak
 * one account's key into the next account's job.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ userId: string }>();

export function runWithAiUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn);
}

export function currentAiUser(): string | null {
  return storage.getStore()?.userId ?? null;
}
