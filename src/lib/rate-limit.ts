/**
 * Generic fixed-window rate limiter for unauthenticated/abuse-prone endpoints
 * (OAuth login/token, password reset). Backed by the durable store so limits
 * hold across instances (CWE-307). Distinct from `protocols/shared/limits.ts`,
 * which is per-agent.
 */

import { getStore } from "@/lib/store";

export interface RateLimitResult {
	allowed: boolean;
	/** Seconds until the current window resets (for the Retry-After header). */
	retryAfterSeconds: number;
}

/**
 * Best-effort client IP. On Cloudflare `cf-connecting-ip` is set by the edge and
 * trustworthy; `x-forwarded-for`/`x-real-ip` are fallbacks (spoofable, so pair
 * IP limits with a per-account/per-identifier limit).
 */
export function clientIp(request: Request): string {
	const h = request.headers;
	return (
		h.get("cf-connecting-ip") ||
		h.get("x-real-ip") ||
		(h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
		"unknown"
	);
}

/** Increment the counter for `key` and report whether it's within `max` per `windowSeconds`. */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
	const store = getStore();
	const nowS = Math.floor(Date.now() / 1000);
	const windowId = Math.floor(nowS / windowSeconds);
	const k = `authrl:${key}:${windowId}`;
	const count = await store.incr(k);
	if (count === 1) await store.expire(k, windowSeconds);
	if (count > max) {
		return { allowed: false, retryAfterSeconds: Math.max(1, windowSeconds - (nowS % windowSeconds)) };
	}
	return { allowed: true, retryAfterSeconds: 0 };
}
