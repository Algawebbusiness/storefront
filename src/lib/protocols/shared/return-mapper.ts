/**
 * Order return / refund domain types and helpers (Phase C1).
 *
 * `POST /api/ucp/rest/orders/:id/return` accepts an agent-initiated refund
 * request. C1 only persists the intent and validates eligibility; the actual
 * Saleor `OrderRefund` / `FulfillmentReturnProducts` mutations are wired up
 * in C2. This split keeps each step shippable on its own.
 *
 * The store is hybrid:
 *   - In-memory `Map` for dev / single-process deployments (entries expire
 *     when the process restarts — acceptable for a record-keeping surface
 *     that's also written to Payload).
 *   - Payload `agent-order-returns` collection when `PAYLOAD_API_URL` is set
 *     (real persistence, audit, merchant UI).
 *
 * Refund reasons and refund-method strings come from the UCP 2026-04-08
 * returns spec; we keep them as closed unions so a typo at a call site is
 * a TypeScript error rather than a runtime fallback.
 */

import type { SaleorOrder } from "./order-queries";

/** Reason the customer / agent gives for initiating the return. */
export type ReturnReason =
	| "defective"
	| "not_as_described"
	| "changed_mind"
	| "wrong_item";

/** Where the refunded value lands. */
export type RefundMethod = "original_payment" | "store_credit";

/** Lifecycle of one return record. C1 only emits `pending`. */
export type ReturnStatus = "pending" | "approved" | "rejected" | "refunded";

/** One line being returned (partial) — empty array means "full order". */
export interface ReturnLineRequest {
	line_id: string;
	quantity: number;
}

/** Body shape accepted by `POST /orders/:id/return`. */
export interface CreateReturnInput {
	order_id: string;
	agent_id: string;
	/** OAuth user-id from the bearer JWT (`auth.userContext.userId`). */
	user_id: string;
	reason: ReturnReason;
	note?: string;
	lines?: ReturnLineRequest[];
	refund_method: RefundMethod;
	/** Optional agent webhook for status push (C3). */
	webhook_url?: string;
}

/** What the REST endpoint returns to the agent. */
export interface CreateReturnResult {
	return_id: string;
	status: ReturnStatus;
	estimated_refund_cents: number;
	currency: string;
	/** ISO timestamp, present when the refund window can be predicted. */
	expected_refund_at?: string;
}

/** Full return record (in-memory + Payload row). */
export interface OrderReturn {
	id: string;
	order_id: string;
	agent_id: string;
	user_id: string;
	reason: ReturnReason;
	note?: string;
	lines: ReturnLineRequest[];
	refund_method: RefundMethod;
	status: ReturnStatus;
	estimated_refund_cents: number;
	currency: string;
	webhook_url?: string;
	created_at: string;
	updated_at: string;
}

/**
 * Why a return wasn't created. The route translates these to client-facing
 * error codes (400 / 409 / 410); keeping them as a discriminated union here
 * means new reasons are caught at every call site.
 */
export type ReturnEligibility =
	| { ok: true }
	| { ok: false; code: "already_returned"; message: string }
	| { ok: false; code: "window_expired"; message: string }
	| { ok: false; code: "not_paid"; message: string }
	| { ok: false; code: "unknown_line"; message: string };

const returnsStore = new Map<string, OrderReturn>();

/** Default cutoff in days. Override via `RETURN_WINDOW_DAYS` env var. */
const DEFAULT_RETURN_WINDOW_DAYS = 30;

function getReturnWindowDays(): number {
	const raw = process.env.RETURN_WINDOW_DAYS;
	if (!raw) return DEFAULT_RETURN_WINDOW_DAYS;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETURN_WINDOW_DAYS;
}

/**
 * Check whether `order` is eligible for a return given the requested lines.
 *
 * Three guardrails:
 *   1. Order must be paid (Saleor `isPaid`).
 *   2. Order created date must be within the `RETURN_WINDOW_DAYS` window.
 *   3. Every requested `line_id` must exist on the order.
 *
 * "Already returned" detection isn't possible without the C2 Saleor status
 * field; we instead check our local store for an existing terminal return.
 */
export function checkReturnEligibility(
	order: SaleorOrder,
	requestedLines: ReturnLineRequest[] | undefined,
	existingReturns: OrderReturn[],
): ReturnEligibility {
	if (!order.isPaid) {
		return {
			ok: false,
			code: "not_paid",
			message: "Order has not been paid, nothing to refund",
		};
	}

	const ageMs = Date.now() - new Date(order.created).getTime();
	const windowMs = getReturnWindowDays() * 24 * 60 * 60 * 1000;
	if (ageMs > windowMs) {
		return {
			ok: false,
			code: "window_expired",
			message: `Return window of ${getReturnWindowDays()} days has expired`,
		};
	}

	if (existingReturns.some((r) => r.status === "refunded" || r.status === "approved")) {
		return {
			ok: false,
			code: "already_returned",
			message: "Order already has an approved or refunded return",
		};
	}

	if (requestedLines && requestedLines.length > 0) {
		const orderLineIds = new Set(order.lines.map((l) => l.id));
		for (const reqLine of requestedLines) {
			if (!orderLineIds.has(reqLine.line_id)) {
				return {
					ok: false,
					code: "unknown_line",
					message: `Line ${reqLine.line_id} is not on order ${order.id}`,
				};
			}
		}
	}

	return { ok: true };
}

/**
 * Compute the estimated refund amount for the requested lines.
 *
 * Empty `lines` ⇒ full-order refund: sum the gross totals (the customer
 * doesn't pay tax separately in Saleor `total.gross`, so this is the same
 * number Stripe charged).
 *
 * Partial refund: sum `unitPrice.gross × quantity` for the requested lines.
 * The shipping cost is intentionally NOT included — partial returns rarely
 * refund shipping, and merchants override per-tenant in Phase E.
 */
export function estimateRefundCents(
	order: SaleorOrder,
	requestedLines: ReturnLineRequest[] | undefined,
): { amount_cents: number; currency: string } {
	const currency = order.total.gross.currency;

	if (!requestedLines || requestedLines.length === 0) {
		return {
			amount_cents: Math.round(order.total.gross.amount * 100),
			currency,
		};
	}

	const lineById = new Map(order.lines.map((l) => [l.id, l]));
	let total = 0;
	for (const reqLine of requestedLines) {
		const line = lineById.get(reqLine.line_id);
		if (!line) continue; // checkReturnEligibility already rejected this
		const unit = line.unitPrice.gross.amount;
		total += Math.round(unit * 100 * reqLine.quantity);
	}
	return { amount_cents: total, currency };
}

/**
 * Update the in-memory record's status. Returns the updated record or
 * `undefined` if no record with the given id exists. Used by the webhook
 * handler when Saleor confirms / rejects the refund and by the polling
 * endpoint when reading a state-changed record.
 */
export function updateReturnStatus(
	id: string,
	status: ReturnStatus,
): OrderReturn | undefined {
	const existing = returnsStore.get(id);
	if (!existing) return undefined;
	const updated: OrderReturn = {
		...existing,
		status,
		updated_at: new Date().toISOString(),
	};
	returnsStore.set(id, updated);
	return updated;
}

/**
 * Find the most recent pending return for a Saleor order. Used by webhook
 * handlers that receive an `ORDER_REFUNDED` event and need to attribute it
 * to a specific return record. We pick the newest by `created_at` so a
 * second refund (e.g., merchant manually refunds shipping later) doesn't
 * back-fill a previously settled return.
 */
export function findPendingReturnForOrder(orderId: string): OrderReturn | undefined {
	const matches = Array.from(returnsStore.values())
		.filter((r) => r.order_id === orderId && r.status === "pending")
		.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
	return matches[0];
}

/** Create a return record and persist it. C1 just stores `pending`. */
export async function createReturnRecord(input: CreateReturnInput, order: SaleorOrder): Promise<OrderReturn> {
	const id = generateReturnId();
	const now = new Date().toISOString();
	const estimate = estimateRefundCents(order, input.lines);
	const record: OrderReturn = {
		id,
		order_id: input.order_id,
		agent_id: input.agent_id,
		user_id: input.user_id,
		reason: input.reason,
		...(input.note ? { note: input.note } : {}),
		lines: input.lines ?? [],
		refund_method: input.refund_method,
		status: "pending",
		estimated_refund_cents: estimate.amount_cents,
		currency: estimate.currency,
		...(input.webhook_url ? { webhook_url: input.webhook_url } : {}),
		created_at: now,
		updated_at: now,
	};

	returnsStore.set(id, record);
	await persistToPayload(record).catch(() => undefined);
	return record;
}

/** Lookup the local cache. Used by the polling endpoint (added in C2). */
export function getReturnRecord(id: string): OrderReturn | undefined {
	return returnsStore.get(id);
}

/** All returns currently held in memory for a given order — used by eligibility. */
export function listReturnsForOrder(orderId: string): OrderReturn[] {
	return Array.from(returnsStore.values()).filter((r) => r.order_id === orderId);
}

/** Test helper. */
export function _resetReturnsStore(): void {
	returnsStore.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function generateReturnId(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
	return `ret_${hex}`;
}

async function persistToPayload(record: OrderReturn): Promise<void> {
	if (!process.env.PAYLOAD_API_URL) return;
	try {
		await fetch(`${process.env.PAYLOAD_API_URL}/agent-order-returns`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(process.env.PAYLOAD_API_KEY
					? { Authorization: `users API-Key ${process.env.PAYLOAD_API_KEY}` }
					: {}),
			},
			body: JSON.stringify(record),
		});
	} catch (err) {
		console.warn(
			`[returns] Payload write failed (kept in memory): ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
