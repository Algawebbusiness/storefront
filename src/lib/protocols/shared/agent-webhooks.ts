/**
 * Outbound agent webhook delivery (Phase C3).
 *
 * When an agent registers a `webhook_url` on a long-running operation (e.g.,
 * a pending return), we push status changes to that URL instead of forcing
 * the agent to poll. The wire format:
 *
 *   POST <webhook_url>
 *   Content-Type: application/json
 *   UCP-Signature: keyid="…",alg="ed25519",sig="<base64>"
 *   UCP-Event-Type: <event.type>
 *   { ...event JSON... }
 *
 * Delivery is best-effort with exponential backoff (2^attempt seconds).
 * Failures are logged via `[agent-log]` and `[agent-webhook]` so an external
 * shipper can surface them. We never throw — webhook delivery must not
 * abort the originating webhook handler / cron / route.
 *
 * Edge runtime: this module uses `globalThis.crypto.subtle` indirectly via
 * `signPayload`, and `fetch` is global. No `node:crypto` imports.
 */

import { logAgentAction } from "./agent-log";
import { getSigningKey, signPayload } from "./signing";

/** A single status-change event delivered to the agent. */
export interface AgentEvent {
	type: string;
	resource_type: "return" | "order" | "checkout";
	resource_id: string;
	agent_id: string;
	/** Snapshot of the new state (status, currency, amounts…). */
	payload: Record<string, unknown>;
	/** Caller may pre-stamp; otherwise the helper fills with Date.now ISO. */
	emitted_at?: string;
}

export interface NotifyResult {
	delivered: boolean;
	attempts: number;
	last_status?: number;
	last_error?: string;
}

/**
 * Send `event` to `webhook_url` with up to `MAX_ATTEMPTS` tries, backing off
 * exponentially (2s, 4s, 8s, 16s, 32s by default). Each attempt:
 *   - signs the JSON body with our ed25519 key,
 *   - attaches `UCP-Signature` (RFC-9421 inspired) and `UCP-Event-Type`,
 *   - treats any 2xx as success.
 *
 * Final outcome is logged to `agent-activity` for auditability.
 *
 * @param sleepMs   Pluggable for tests — they pass a no-op to avoid waiting.
 */
export async function notifyAgent(
	webhook_url: string,
	event: AgentEvent,
	opts: {
		max_attempts?: number;
		sleepMs?: (ms: number) => Promise<void>;
	} = {},
): Promise<NotifyResult> {
	const max = opts.max_attempts ?? MAX_ATTEMPTS;
	const sleep = opts.sleepMs ?? defaultSleep;
	const enriched: AgentEvent = {
		...event,
		emitted_at: event.emitted_at ?? new Date().toISOString(),
	};
	const body = JSON.stringify(enriched);
	const [signature, { keyId }] = await Promise.all([signPayload(body), getSigningKey()]);
	const sigHeader = `keyid="${keyId}",alg="ed25519",sig="${signature}"`;

	let lastStatus: number | undefined;
	let lastError: string | undefined;

	for (let attempt = 1; attempt <= max; attempt++) {
		try {
			const res = await fetch(webhook_url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"UCP-Signature": sigHeader,
					"UCP-Event-Type": enriched.type,
				},
				body,
				signal: AbortSignal.timeout(10_000),
			});
			lastStatus = res.status;
			if (res.ok) {
				logDelivery(enriched, webhook_url, { delivered: true, attempts: attempt, last_status: res.status });
				return { delivered: true, attempts: attempt, last_status: res.status };
			}
			lastError = `HTTP ${res.status}`;
		} catch (err) {
			lastError = err instanceof Error ? err.message : String(err);
		}

		if (attempt < max) {
			await sleep(backoffMs(attempt));
		}
	}

	const result: NotifyResult = {
		delivered: false,
		attempts: max,
		...(lastStatus !== undefined ? { last_status: lastStatus } : {}),
		...(lastError ? { last_error: lastError } : {}),
	};
	logDelivery(enriched, webhook_url, result);
	return result;
}

const MAX_ATTEMPTS = 5;

function backoffMs(attempt: number): number {
	return Math.pow(2, attempt) * 1000;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function logDelivery(event: AgentEvent, url: string, result: NotifyResult): void {
	const safeUrl = url.replace(/[\r\n]/g, "");
	console.log(
		`[agent-webhook] ${event.type} → ${safeUrl} delivered=${result.delivered} attempts=${result.attempts}${result.last_status ? ` status=${result.last_status}` : ""}${result.last_error ? ` error="${result.last_error.replace(/"/g, '\\"')}"` : ""}`,
	);
	logAgentAction({
		agent_id: event.agent_id,
		action: "webhook.deliver",
		resource_id: event.resource_id,
		status: result.delivered ? "success" : "error",
		status_code: result.last_status ?? 0,
		duration_ms: 0,
	});
}
