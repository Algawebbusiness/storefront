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

import { SupabaseKvStore } from "./supabase";

export interface KvStore {
	/** Get a string value, or null if missing/expired. */
	get(key: string): Promise<string | null>;
	/** Set a string value with an optional TTL in seconds. */
	set(key: string, value: string, ttlSeconds?: number): Promise<void>;
	/** Set only if the key does not exist; returns true if set (atomic — for nonce/replay). */
	setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean>;
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
	async setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
		if (this.aliveKv(key)) return false;
		this.kv.set(key, { value, expiresAtMs: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null });
		return true;
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
	async setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
		const args = ttlSeconds ? ["SET", key, value, "NX", "EX", ttlSeconds] : ["SET", key, value, "NX"];
		const result = await this.cmd<string | null>(args);
		return result === "OK";
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

// ─────────────────────── Tenant key-prefixing wrapper ───────────────────────

/**
 * Wraps any `KvStore` and prefixes every key with `tenant:<id>:` so multiple
 * client storefronts can SAFELY share one backend (soft isolation by namespace;
 * see CLAUDE.md for the security trade-offs vs a per-tenant store).
 */
class PrefixedStore implements KvStore {
	constructor(
		private prefix: string,
		private inner: KvStore,
	) {}
	private k(key: string): string {
		return `${this.prefix}:${key}`;
	}
	get(key: string) {
		return this.inner.get(this.k(key));
	}
	set(key: string, value: string, ttl?: number) {
		return this.inner.set(this.k(key), value, ttl);
	}
	setnx(key: string, value: string, ttl?: number) {
		return this.inner.setnx(this.k(key), value, ttl);
	}
	del(key: string) {
		return this.inner.del(this.k(key));
	}
	getdel(key: string) {
		return this.inner.getdel(this.k(key));
	}
	incr(key: string) {
		return this.inner.incr(this.k(key));
	}
	incrby(key: string, amount: number) {
		return this.inner.incrby(this.k(key), amount);
	}
	expire(key: string, ttl: number) {
		return this.inner.expire(this.k(key), ttl);
	}
	sadd(key: string, member: string) {
		return this.inner.sadd(this.k(key), member);
	}
	sismember(key: string, member: string) {
		return this.inner.sismember(this.k(key), member);
	}
	scard(key: string) {
		return this.inner.scard(this.k(key));
	}
}

// ───────────────────────────── Factory ──────────────────────────────────────

let singleton: KvStore | null = null;
let backend: KvStore | null = null;
let warnedInMemory = false;

function buildBackend(): KvStore {
	// 1. Supabase (HTTP, works on edge + Node; reuses an existing project).
	const sbUrl = process.env.SUPABASE_URL;
	const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (sbUrl && sbKey) return new SupabaseKvStore(sbUrl, sbKey);

	// 2. Upstash Redis (HTTP).
	const upUrl = process.env.UPSTASH_REDIS_REST_URL;
	const upToken = process.env.UPSTASH_REDIS_REST_TOKEN;
	if (upUrl && upToken) return new UpstashKvStore(upUrl, upToken);

	// 3. In-memory fallback (dev/test/single-instance) — unsafe in serverless prod.
	if (process.env.NODE_ENV === "production" && !warnedInMemory) {
		warnedInMemory = true;
		console.warn(
			"[store] No durable store configured (SUPABASE_* or UPSTASH_*) — falling back to in-memory. " +
				"UNSAFE on multi-instance/serverless deploys (revoked tokens, rate/spend caps, nonces, " +
				"and locks do not hold across instances).",
		);
	}
	return new InMemoryKvStore();
}

export function getStore(): KvStore {
	if (singleton) return singleton;
	backend = buildBackend();
	const prefix = process.env.STORE_TENANT_PREFIX;
	singleton = prefix ? new PrefixedStore(prefix, backend) : backend;
	return singleton;
}

/** Test helper: reset the in-memory singleton between tests. */
export function _resetStore(): void {
	if (backend instanceof InMemoryKvStore) backend._reset();
	singleton = null;
	backend = null;
}
