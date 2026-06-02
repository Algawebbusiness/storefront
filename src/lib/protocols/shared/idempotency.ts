/**
 * Idempotency / mutual-exclusion locks for money-moving operations (CWE-367).
 *
 * Backed by the durable store's atomic `setnx`, so two concurrent requests (or
 * a retry racing the original) cannot both charge / refund the same resource —
 * across instances, not just within one process. The lock is held only briefly
 * (a single request's lifetime); release it on failure so a genuine retry can
 * proceed, keep it on success so a duplicate submit is rejected.
 */

import { getStore } from "@/lib/store";

/** Default lock lifetime — long enough to cover a charge + complete round-trip. */
const DEFAULT_LOCK_TTL_S = 120;

/** Try to acquire `key`. Returns true if acquired, false if already held. */
export async function acquireLock(key: string, ttlSeconds: number = DEFAULT_LOCK_TTL_S): Promise<boolean> {
	return getStore().setnx(`lock:${key}`, "1", ttlSeconds);
}

/** Release a previously acquired lock (call when the operation failed/should be retryable). */
export async function releaseLock(key: string): Promise<void> {
	await getStore().del(`lock:${key}`);
}
