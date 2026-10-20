/**
 * The account an AI call is being made for, when the call site cannot say.
 *
 * Request handlers pass `userId` explicitly. Background work (the processing
 * queue, the sweeper, skills, heartbeat, delegated tasks) runs many accounts'
 * jobs in one process, deep below functions that never took a user id; it
 * wraps each job in `runWithAiUser` so whatever that job calls bills the
 * job's owner, not whoever ran last.
 *
 * The same scope can carry a `purpose` ("Note summary", "Skill: daily
 * digest"), which the usage log shows for calls whose site did not name one.
 *
 * `run`, never `enterWith`: a scope that ends with the callback cannot leak
 * one account's key into the next account's job.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ userId: string | null; purpose?: string }>();

export function runWithAiUser<T>(userId: string, fn: () => T, purpose?: string): T {
  return storage.run({ userId, purpose }, fn);
}

/** Label the AI calls made inside `fn`, keeping whichever account is current. */
export function runWithAiPurpose<T>(purpose: string, fn: () => T): T {
  return storage.run({ userId: storage.getStore()?.userId ?? null, purpose }, fn);
}

export function currentAiUser(): string | null {
  return storage.getStore()?.userId ?? null;
}

export function currentAiPurpose(): string | null {
  return storage.getStore()?.purpose ?? null;
}
