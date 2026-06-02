import type { KvStore } from "./index";

/**
 * KvStore backed by Supabase Postgres via PostgREST RPC (`public.agentkv_*`
 * wrappers over the private `agent_store` schema). HTTP-only, so it works on
 * Cloudflare Workers / Vercel Edge as well as Node (Coolify) — no TCP, no npm
 * dependency. Uses the service-role key server-side; never expose that key to
 * the client.
 */
export class SupabaseKvStore implements KvStore {
	private readonly rpcBase: string;
	private readonly headers: Record<string, string>;

	constructor(url: string, serviceRoleKey: string) {
		this.rpcBase = `${url.replace(/\/$/, "")}/rest/v1/rpc`;
		this.headers = {
			apikey: serviceRoleKey,
			Authorization: `Bearer ${serviceRoleKey}`,
			"Content-Type": "application/json",
		};
	}

	private async rpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
		const res = await fetch(`${this.rpcBase}/${fn}`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(params),
		});
		if (!res.ok) {
			throw new Error(`Supabase RPC ${fn} failed: HTTP ${res.status}`);
		}
		// Scalar-returning functions return the value directly (or null for void).
		const text = await res.text();
		return (text ? JSON.parse(text) : null) as T;
	}

	async get(key: string): Promise<string | null> {
		return (await this.rpc<string | null>("agentkv_get", { p_key: key })) ?? null;
	}
	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		await this.rpc("agentkv_set", { p_key: key, p_value: value, p_ttl: ttlSeconds ?? null });
	}
	async setnx(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
		return (
			(await this.rpc<boolean>("agentkv_setnx", {
				p_key: key,
				p_value: value,
				p_ttl: ttlSeconds ?? null,
			})) === true
		);
	}
	async del(key: string): Promise<void> {
		await this.rpc("agentkv_del", { p_key: key });
	}
	async getdel(key: string): Promise<string | null> {
		return (await this.rpc<string | null>("agentkv_getdel", { p_key: key })) ?? null;
	}
	async incr(key: string): Promise<number> {
		return this.incrby(key, 1);
	}
	async incrby(key: string, amount: number): Promise<number> {
		return Number(await this.rpc<number | string>("agentkv_incrby", { p_key: key, p_amount: amount }));
	}
	async expire(key: string, ttlSeconds: number): Promise<void> {
		await this.rpc("agentkv_expire", { p_key: key, p_ttl: ttlSeconds });
	}
	async sadd(key: string, member: string): Promise<void> {
		await this.rpc("agentkv_sadd", { p_key: key, p_member: member, p_ttl: null });
	}
	async sismember(key: string, member: string): Promise<boolean> {
		return (await this.rpc<boolean>("agentkv_sismember", { p_key: key, p_member: member })) === true;
	}
	async scard(key: string): Promise<number> {
		return Number(await this.rpc<number | string>("agentkv_scard", { p_key: key }));
	}
}
