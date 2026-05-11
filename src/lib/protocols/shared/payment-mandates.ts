/**
 * Recurring payment mandate skeleton (Phase C9).
 *
 * MPP (Machine Payments Protocol) requires the agent to obtain a *mandate*
 * before initiating recurring / streaming / micro charges. C9 ships the
 * surface: agents can POST a mandate definition, get back a mandate ID,
 * and remember it for later charges. Actual debit flow is E7 territory.
 *
 * Storage is in-memory + best-effort Payload (the same pattern as approvals
 * and returns). Mandates expire automatically when their `expires_at` passes
 * — `getMandateStatus` lazily flips `pending`/`active` to `expired` on read
 * so we don't need a cron.
 */

import type { AgentIdentity } from "./agent-registry-types";

export type MandatePeriod = "day" | "week" | "month";
export type MandateStatus = "pending" | "active" | "expired" | "revoked";

export interface PaymentMandate {
	id: string;
	agent_id: string;
	max_per_period_cents: number;
	currency: string;
	period: MandatePeriod;
	status: MandateStatus;
	expires_at: string;
	created_at: string;
	updated_at: string;
	/** Optional natural-language scope, persisted in metadata for audit. */
	description?: string;
}

export interface CreateMandateInput {
	agent: AgentIdentity;
	max_per_period_cents: number;
	currency: string;
	period: MandatePeriod;
	expires_at: string;
	description?: string;
}

const mandates = new Map<string, PaymentMandate>();

/**
 * Mint a new mandate and persist it. The C9 skeleton sets status to
 * `active` immediately — Phase E7 adds a merchant approval step before
 * the mandate goes live.
 */
export async function createMandate(input: CreateMandateInput): Promise<PaymentMandate> {
	const id = generateMandateId();
	const now = new Date().toISOString();
	const mandate: PaymentMandate = {
		id,
		agent_id: input.agent.id,
		max_per_period_cents: input.max_per_period_cents,
		currency: input.currency,
		period: input.period,
		status: "active",
		expires_at: input.expires_at,
		created_at: now,
		updated_at: now,
		...(input.description ? { description: input.description } : {}),
	};
	mandates.set(id, mandate);
	await persistToPayload(mandate).catch(() => undefined);
	return mandate;
}

/**
 * Return the mandate with auto-expiry applied. Returns `undefined` for
 * unknown IDs (callers translate to 404).
 */
export function getMandateStatus(id: string): PaymentMandate | undefined {
	const m = mandates.get(id);
	if (!m) return undefined;
	if (m.status === "active" || m.status === "pending") {
		if (Date.now() > new Date(m.expires_at).getTime()) {
			const expired: PaymentMandate = {
				...m,
				status: "expired",
				updated_at: new Date().toISOString(),
			};
			mandates.set(id, expired);
			return expired;
		}
	}
	return m;
}

/** Drop the in-memory store — test helper. */
export function _resetMandates(): void {
	mandates.clear();
}

function generateMandateId(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `mnd_${hex}`;
}

async function persistToPayload(mandate: PaymentMandate): Promise<void> {
	if (!process.env.PAYLOAD_API_URL) return;
	try {
		await fetch(`${process.env.PAYLOAD_API_URL}/agent-payment-mandates`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(process.env.PAYLOAD_API_KEY
					? { Authorization: `users API-Key ${process.env.PAYLOAD_API_KEY}` }
					: {}),
			},
			body: JSON.stringify(mandate),
		});
	} catch (err) {
		console.warn(
			`[mandates] Payload write failed (kept in memory): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
