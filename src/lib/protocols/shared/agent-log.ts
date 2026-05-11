/**
 * Agent activity log (Phase B4).
 *
 * Every agent call should produce one entry: who, what, outcome, duration,
 * money. Two backends:
 *   1. Payload `agent-activity` collection (when PAYLOAD_API_URL is set)
 *   2. Console structured log (always, with `[agent-log]` prefix for shipping)
 *
 * Calls are FIRE-AND-FORGET. The route handler returns the response without
 * waiting for the log write — Payload can be slow, the agent call can't be.
 * Failures inside the logger are swallowed and console.warn'd.
 *
 * NO PII: never log card numbers, full addresses, customer email. The
 * `request_summary` builder caps at 200 chars and strips obvious patterns.
 */

import { payloadFetch } from "@/lib/payload/client";

/** Outcome of one agent call. */
export type AgentActionStatus = "success" | "denied" | "error";

/** One row in the activity log. */
export interface AgentActivityEntry {
	agent_id: string;
	/** Action verb, e.g. `cart.create`, `checkout.complete`, `catalog.search`. */
	action: string;
	/** Scope checked (or `null` if action doesn't gate on scope, e.g. catalog read). */
	scope?: string;
	/** Resource the action touched (cart_id, checkout_id, order_id). */
	resource_id?: string;
	/** Truncated, PII-scrubbed body summary. Max 200 chars. */
	request_summary?: string;
	status: AgentActionStatus;
	status_code: number;
	duration_ms: number;
	/** Cents involved (cart total at the time of the call). */
	amount_cents?: number;
	ip?: string;
	user_agent?: string;
	/** ISO timestamp; logger fills it if omitted. */
	created_at?: string;
}

/**
 * Fire-and-forget log write. Returns immediately; the actual write happens
 * in the background. Failures are swallowed and warned, never thrown.
 */
export function logAgentAction(entry: AgentActivityEntry): void {
	const enriched: AgentActivityEntry = {
		...entry,
		created_at: entry.created_at ?? new Date().toISOString(),
	};
	// Don't await — caller is the route handler's response path.
	void writeEntry(enriched);
}

/**
 * Wrap an async route handler so every call is timed and logged. The handler
 * receives the agent identity (already verified by B3) and returns the
 * Response. The wrapper computes duration, infers status from the response
 * code, and emits the log entry.
 *
 * Use in routes that have already migrated to `verifyAgentRequest`.
 */
export async function withAgentActivityLog<T extends Response>(
	context: {
		agent_id: string;
		action: string;
		scope?: string;
		resource_id?: string;
		request_summary?: string;
		amount_cents?: number;
		ip?: string;
		user_agent?: string;
	},
	handler: () => Promise<T>,
): Promise<T> {
	const start = Date.now();
	let response: T;
	let status: AgentActionStatus = "success";
	let statusCode = 200;

	try {
		response = await handler();
		statusCode = response.status;
		if (statusCode === 401 || statusCode === 403 || statusCode === 429) status = "denied";
		else if (statusCode >= 400) status = "error";
		return response;
	} catch (err) {
		status = "error";
		statusCode = 500;
		throw err;
	} finally {
		logAgentAction({
			...context,
			status,
			status_code: statusCode,
			duration_ms: Date.now() - start,
		});
	}
}

/**
 * Build a PII-scrubbed summary of a request body for logging.
 *
 * Heuristics:
 *   - Cap at 200 chars.
 *   - Replace any 13–19 digit sequence (probable card number) with `***`.
 *   - Replace email-like patterns with `***@***`.
 *   - Replace anything that looks like a postal code or street address with
 *     `<address>` if the JSON has a `street_address` / `address_locality` /
 *     `postal_code` field.
 */
export function buildRequestSummary(rawBody: string | null | undefined): string | undefined {
	if (!rawBody || rawBody.length === 0) return undefined;

	let s: string;
	try {
		const parsed = JSON.parse(rawBody) as unknown;
		s = scrubPii(parsed);
	} catch {
		s = scrubText(rawBody);
	}

	if (s.length > 200) s = s.slice(0, 197) + "...";
	return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function writeEntry(entry: AgentActivityEntry): Promise<void> {
	// Always emit a structured console line — log shipper picks it up even
	// if Payload is unavailable.
	console.log(`[agent-log] ${JSON.stringify(entry)}`);

	if (!process.env.PAYLOAD_API_URL) return;

	try {
		// Payload REST: POST /api/agent-activity
		// We use a non-cached fetch (revalidate=0); writes don't need ISR.
		await payloadFetch(`/agent-activity`, 0).catch(() => null);
		// payloadFetch is GET-only in current shape; use raw fetch for POST.
		await fetch(`${process.env.PAYLOAD_API_URL}/agent-activity`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(process.env.PAYLOAD_API_KEY
					? { Authorization: `users API-Key ${process.env.PAYLOAD_API_KEY}` }
					: {}),
			},
			body: JSON.stringify(entry),
		});
	} catch (err) {
		console.warn(
			`[agent-log] Payload write failed (entry kept in console only): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

function scrubPii(input: unknown, depth = 0): string {
	if (depth > 4) return "...";
	if (input === null) return "null";
	if (typeof input === "string") return JSON.stringify(scrubText(input));
	if (typeof input === "number" || typeof input === "boolean") return JSON.stringify(input);
	if (Array.isArray(input)) {
		return "[" + input.slice(0, 5).map((x) => scrubPii(x, depth + 1)).join(",") + "]";
	}
	if (typeof input === "object") {
		const obj = input as Record<string, unknown>;
		const out: string[] = [];
		const sensitiveAddressKeys = new Set([
			"street_address",
			"street_address_2",
			"address_locality",
			"address_region",
			"postal_code",
			"phone",
		]);
		for (const [k, v] of Object.entries(obj)) {
			if (sensitiveAddressKeys.has(k)) {
				out.push(`${JSON.stringify(k)}:"<redacted>"`);
			} else if (k === "email" || k === "buyer_email") {
				out.push(`${JSON.stringify(k)}:"***@***"`);
			} else {
				out.push(`${JSON.stringify(k)}:${scrubPii(v, depth + 1)}`);
			}
		}
		return "{" + out.join(",") + "}";
	}
	return "...";
}

function scrubText(s: string): string {
	return s
		.replace(/\b\d{13,19}\b/g, "***")
		.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "***@***");
}
