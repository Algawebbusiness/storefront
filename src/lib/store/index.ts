/**
 * Durable key/value store for security-critical state that must survive across
 * serverless instances and cold starts (Block 9):
 *   - OAuth authorization codes (single-use, short TTL)
 *   - revoked refresh-token JTIs
 *   - rate-limit + session-per-day counters
 *   - cumulative spend counters
 *
 * In-memory Maps (the previous implementation) silently break on multi-instance
 * / serverless deploys: a revoked token is accepted on another instance, rate
 * and spend caps reset on cold start and multiply across instances, and auth
 * codes are single-use only within one instance.
 *
 * Backend is pluggable behind `KvStore`:
 *   - `UpstashKvStore` (Upstash Redis REST — no npm dependency, edge-safe) is
 *     used when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set.
 *   - otherwise an in-memory store (dev/test/single-instance) with a one-time
 *     production warning.
 */

export interface KvStore {
	/** Get a string value, or null if missing/expired. */
	get(key: string): Promise<string | null>;
	/** Set a string value with an optional TTL in seconds. */
	set(key: string, value: string, ttlSeconds?: number): Promise<void>;
	/** Delete a key. */
	del(key: string): Promise<void>;
	/** Atomically get-and-delete (single-use consume; replay-safe). */
	getdel(key: string): Promise<string | null>;
	/** Atomic increment by 1; returns the new value. */
	incr(key: string): Promise<number>;
	/** Atomic increment by `amount`; returns the new value. */
	incrby(key: string, amount: number): Promise<number>;
	/** Set/refresh a key's TTL in seconds. */
	expire(key: string, ttlSeconds: number): Promise<void>;
	/** Add a member to a set. */
	sadd(key: string, member: string): Promise<void>;
	/** Whether `member` is in the set. */
	sismember(key: string, member: string): Promise<boolean>;
	/** Cardinality of a set. */
	scard(key: string): Promise<number>;
}

// ───────────────────────── In-memory implementation ─────────────────────────

interface KvEntry {
	value: string;
	expiresAtMs: number | null;
}
interface SetEntry {
	members: Set<string>;
	expiresAtMs: number | null;
}

export class InMemoryKvStore implements KvStore {
	private kv = new Map<string, KvEntry>();
	private sets = new Map<string, SetEntry>();

	private aliveKv(key: string): KvEntry | undefined {
		const e = this.kv.get(key);
		if (!e) return undefined;
		if (e.expiresAtMs !== null && Date.now() > e.expiresAtMs) {
			this.kv.delete(key);
			return undefined;
		}
		return e;
	}
	private aliveSet(key: string): SetEntry | undefined {
		const e = this.sets.get(key);
		if (!e) return undefined;
		if (e.expiresAtMs !== null && Date.now() > e.expiresAtMs) {
			this.sets.delete(key);
			return undefined;
		}
		return e;
	}

	async get(key: string): Promise<string | null> {
		return this.aliveKv(key)?.value ?? null;
	}
	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		this.kv.set(key, { value, expiresAtMs: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
	}
	async del(key: string): Promise<void> {
		this.kv.delete(key);
	}
	async getdel(key: string): Promise<string | null> {
		const v = this.aliveKv(key)?.value ?? null;
		this.kv.delete(key);
		return v;
	}
	async incr(key: string): Promise<number> {
		return this.incrby(key, 1);
	}
	async incrby(key: string, amount: number): Promise<number> {
		const e = this.aliveKv(key);
		const next = (e ? Number(e.value) : 0) + amount;
		this.kv.set(key, { value: String(next), expiresAtMs: e?.expiresAtMs ?? null });
		return next;
	}
	async expire(key: string, ttlSeconds: number): Promise<void> {
		const e = this.aliveKv(key);
		if (e) e.expiresAtMs = Date.now() + ttlSeconds * 1000;
		const s = this.aliveSet(key);
		if (s) s.expiresAtMs = Date.now() + ttlSeconds * 1000;
	}
	async sadd(key: string, member: string): Promise<void> {
		const e = this.aliveSet(key);
		if (e) e.members.add(member);
		else this.sets.set(key, { members: new Set([member]), expiresAtMs: null });
	}
	async sismember(key: string, member: string): Promise<boolean> {
		return this.aliveSet(key)?.members.has(member) ?? false;
	}
	async scard(key: string): Promise<number> {
		return this.aliveSet(key)?.members.size ?? 0;
	}

	/** Test helper: wipe all state. */
	_reset(): void {
		this.kv.clear();
		this.sets.clear();
	}
}

// ───────────────────────── Upstash Redis (REST) ─────────────────────────────

class UpstashKvStore implements KvStore {
	constructor(
		private url: string,
		private token: string,
	) {}

	private async cmd<T = unknown>(args: Array<string | number>): Promise<T> {
		const res = await fetch(this.url, {
			method: "POST",
			headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
			body: JSON.stringify(args),
		});
		if (!res.ok) {
			throw new Error(`Upstash command failed: HTTP ${res.status}`);
		}
		const json = (await res.json()) as { result?: T; error?: string };
		if (json.error) throw new Error(`Upstash error: ${json.error}`);
		return json.result as T;
	}

	async get(key: string): Promise<string | null> {
		return (await this.cmd<string | null>(["GET", key])) ?? null;
	}
	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		await this.cmd(ttlSeconds ? ["SET", key, value, "EX", ttlSeconds] : ["SET", key, value]);
	}
	async del(key: string): Promise<void> {
		await this.cmd(["DEL", key]);
	}
	async getdel(key: string): Promise<string | null> {
		return (await this.cmd<string | null>(["GETDEL", key])) ?? null;
	}
	async incr(key: string): Promise<number> {
		return Number(await this.cmd(["INCR", key]));
	}
	async incrby(key: string, amount: number): Promise<number> {
		return Number(await this.cmd(["INCRBY", key, amount]));
	}
	async expire(key: string, ttlSeconds: number): Promise<void> {
		await this.cmd(["EXPIRE", key, ttlSeconds]);
	}
	async sadd(key: string, member: string): Promise<void> {
		await this.cmd(["SADD", key, member]);
	}
	async sismember(key: string, member: string): Promise<boolean> {
		return Number(await this.cmd(["SISMEMBER", key, member])) === 1;
	}
	async scard(key: string): Promise<number> {
		return Number(await this.cmd(["SCARD", key]));
	}
}

// ───────────────────────────── Factory ──────────────────────────────────────

let singleton: KvStore | null = null;
let warnedInMemory = false;

export function getStore(): KvStore {
	if (singleton) return singleton;

	const url = process.env.UPSTASH_REDIS_REST_URL;
	const token = process.env.UPSTASH_REDIS_REST_TOKEN;
	if (url && token) {
		singleton = new UpstashKvStore(url, token);
		return singleton;
	}

	if (process.env.NODE_ENV === "production" && !warnedInMemory) {
		warnedInMemory = true;
		console.warn(
			"[store] UPSTASH_REDIS_REST_URL/TOKEN not set — falling back to in-memory store. " +
				"This is UNSAFE on multi-instance/serverless deploys (revoked tokens, rate/spend caps, " +
				"and auth-code single-use do not hold across instances). Configure Upstash in production.",
		);
	}
	singleton = new InMemoryKvStore();
	return singleton;
}

/** Test helper: reset the in-memory singleton between tests. */
export function _resetStore(): void {
	if (singleton instanceof InMemoryKvStore) singleton._reset();
	singleton = null;
}
