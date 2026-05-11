/**
 * Pending approval flow for high-risk agent actions (Phase B6).
 *
 * When a cart total crosses APPROVAL_THRESHOLD_CENTS (env var, can be
 * overridden per-tenant once Payload Tenant collection ships), the
 * checkout-complete route doesn't pay immediately — it creates a pending
 * approval and returns 202 with an `approval_url`. The agent polls the
 * approval until it resolves (approved → checkout completes, rejected →
 * cart cancelled, expired → automatic reject).
 *
 * Storage:
 *   - Payload `agent-pending-approvals` collection when configured (UI for
 *     merchant to click approve/reject).
 *   - In-memory Map fallback (single-process, dev). Approvals expire from
 *     the Map automatically when their `expires_at` passes.
 *
 * Notification:
 *   - Resend best-effort: when RESEND_API_KEY + APPROVAL_NOTIFY_EMAIL are
 *     set, send the merchant an email with the approval link.
 *   - Always log to console with `[approval]` prefix so external log
 *     shippers can pick it up.
 *
 * Use `requiresApproval(amountCents, agent)` to decide. Use
 * `createPendingApproval(...)` to enqueue. Use `getApprovalStatus(id)` for
 * the polling endpoint.
 */

import { payloadFetch } from "@/lib/payload/client";
import type { AgentIdentity } from "./agent-registry-types";

/**
 * Default expiry window in milliseconds. Agents shouldn't poll forever;
 * merchant has 24 hours to react.
 */
const DEFAULT_APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface PendingApproval {
	id: string;
	agent_id: string;
	action: string;
	resource_id: string;
	amount_cents: number | null;
	reason: string;
	status: ApprovalStatus;
	expires_at: string;
	created_at: string;
	approved_by?: string;
	approved_at?: string;
}

export interface CreateApprovalInput {
	agent_id: string;
	action: string;
	resource_id: string;
	amount_cents: number | null;
	reason: string;
	ttl_ms?: number;
}

const inMemoryApprovals = new Map<string, PendingApproval>();

/**
 * Should this checkout require approval? Reads APPROVAL_THRESHOLD_CENTS env
 * (Phase B6 — per-tenant Payload override comes in Phase E).
 */
export function requiresApproval(amountCents: number, _agent?: AgentIdentity): boolean {
	const raw = process.env.APPROVAL_THRESHOLD_CENTS;
	if (!raw) return false;
	const threshold = Number(raw);
	if (!Number.isFinite(threshold) || threshold <= 0) return false;
	return amountCents > threshold;
}

/**
 * Create a pending approval record, attempt to notify the merchant, and
 * return the record so the route can build the 202 response payload.
 */
export async function createPendingApproval(
	input: CreateApprovalInput,
): Promise<PendingApproval> {
	const id = generateApprovalId();
	const now = new Date();
	const ttl = input.ttl_ms ?? DEFAULT_APPROVAL_TTL_MS;
	const approval: PendingApproval = {
		id,
		agent_id: input.agent_id,
		action: input.action,
		resource_id: input.resource_id,
		amount_cents: input.amount_cents,
		reason: input.reason,
		status: "pending",
		expires_at: new Date(now.getTime() + ttl).toISOString(),
		created_at: now.toISOString(),
	};

	inMemoryApprovals.set(id, approval);

	// Persist to Payload if configured (best-effort).
	if (process.env.PAYLOAD_API_URL) {
		try {
			await fetch(`${process.env.PAYLOAD_API_URL}/agent-pending-approvals`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(process.env.PAYLOAD_API_KEY
						? { Authorization: `users API-Key ${process.env.PAYLOAD_API_KEY}` }
						: {}),
				},
				body: JSON.stringify(approval),
			});
		} catch (err) {
			console.warn(
				`[approval] Payload write failed for approval ${id}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	console.log(
		`[approval] pending id=${id} agent=${input.agent_id} action=${input.action} amount_cents=${input.amount_cents}`,
	);

	void notifyMerchant(approval);

	return approval;
}

/**
 * Look up the current status of an approval. Reads Payload first (so the
 * merchant's clicks are visible), falls back to in-memory map. Returns
 * null when the approval is unknown.
 */
export async function getApprovalStatus(id: string): Promise<PendingApproval | null> {
	if (process.env.PAYLOAD_API_URL) {
		try {
			const escaped = encodeURIComponent(id);
			const result = await payloadFetch<{ docs: PendingApproval[] }>(
				`/agent-pending-approvals?where[id][equals]=${escaped}&limit=1`,
				0,
			);
			const doc = result?.docs[0];
			if (doc) return autoExpire(doc);
		} catch {
			// Fall through to in-memory.
		}
	}
	const local = inMemoryApprovals.get(id);
	return local ? autoExpire(local) : null;
}

/**
 * Build the agent-facing approval URL. Returned in 202 responses so the
 * agent knows where to poll.
 */
export function buildApprovalUrl(id: string): string {
	const base = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";
	return `${base}/api/ucp/rest/approvals/${encodeURIComponent(id)}`;
}

/**
 * Test-only: drop in-memory state.
 */
export function _resetApprovalsState(): void {
	inMemoryApprovals.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function generateApprovalId(): string {
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return (
		"appr_" +
		Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
	);
}

function autoExpire(approval: PendingApproval): PendingApproval {
	if (approval.status !== "pending") return approval;
	if (Date.now() > new Date(approval.expires_at).getTime()) {
		const expired: PendingApproval = { ...approval, status: "expired" };
		inMemoryApprovals.set(expired.id, expired);
		return expired;
	}
	return approval;
}

async function notifyMerchant(approval: PendingApproval): Promise<void> {
	const apiKey = process.env.RESEND_API_KEY;
	const to = process.env.APPROVAL_NOTIFY_EMAIL;
	if (!apiKey || !to) {
		// No email integration — the [approval] console log is the only signal.
		return;
	}
	const url = buildApprovalUrl(approval.id);
	const subject = `[Algaweb] New agent approval pending — ${approval.action}`;
	const text = [
		`Agent ${approval.agent_id} requested ${approval.action} on ${approval.resource_id}.`,
		`Amount: ${approval.amount_cents != null ? `${approval.amount_cents} cents` : "n/a"}`,
		`Reason: ${approval.reason}`,
		`Expires: ${approval.expires_at}`,
		`Approve or reject in admin or via direct link: ${url}`,
	].join("\n");

	try {
		await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				from: process.env.APPROVAL_NOTIFY_FROM || "approvals@algaweb.cz",
				to: [to],
				subject,
				text,
			}),
		});
	} catch (err) {
		console.warn(
			`[approval] Resend notify failed for ${approval.id}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}
