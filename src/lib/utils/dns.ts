/**
 * Name resolution, isolated behind one function.
 *
 * `safeFetch` needs to know every address a hostname resolves to before it
 * will make a request. Keeping that in its own module means the SSRF checks
 * can be tested against chosen DNS answers instead of whatever the test
 * machine's resolver happens to say — mocking `node:dns` directly does not
 * reach a module under `src/`.
 */

import { lookup } from "node:dns/promises";

/**
 * Every IP address `hostname` resolves to, v4 and v6.
 *
 * Returns an empty array when the name does not resolve; callers treat that
 * as "refuse", not as "no restrictions apply".
 */
export async function resolveHostAddresses(hostname: string): Promise<string[]> {
  try {
    const results = await lookup(hostname, { all: true });
    return results.map((entry) => entry.address);
  } catch {
    return [];
  }
}
