/**
 * Object-level authorization helpers (IDOR / BOLA defense, CWE-639).
 *
 * Resources are fetched from Saleor by opaque ID through a client that runs at
 * app/anonymous trust level, so "knows the ID" must NOT equal "may access it".
 * These helpers assert that the authenticated principal actually owns the
 * resource before a handler returns or mutates it.
 */

import type { UcpRouteAuth } from "./route-handler";

/** Normalize an email for comparison (lowercase + trim). */
function normEmail(email: string | null | undefined): string | null {
	if (!email) return null;
	const trimmed = email.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * True when the OAuth-scoped customer in `auth` owns `order`.
 *
 * Ownership = the order's `userEmail` matches the customer's verified OAuth
 * email. Requires a customer context: agent-only (signed / legacy bearer)
 * tokens carry no customer identity, so they never "own" a customer order and
 * this returns false (callers should 403/404 those).
 */
export function ownsOrder(
	order: { userEmail: string | null },
	auth: Pick<UcpRouteAuth, "userContext">,
): boolean {
	const customerEmail = normEmail(auth.userContext?.email);
	if (!customerEmail) return false;
	const ownerEmail = normEmail(order.userEmail);
	if (!ownerEmail) return false;
	return ownerEmail === customerEmail;
}

/**
 * Saleor metadata key binding a checkout/cart to the agent that created it.
 * Written at create time; checked on every subsequent access so a different
 * agent can't drive a cart/checkout it doesn't own by guessing its ID.
 */
export const AGENT_BINDING_METADATA_KEY = "ucp.agent_id";

/** Metadata item to persist the binding at checkout/cart creation. */
export function agentBindingMetadataItem(agentId: string): { key: string; value: string } {
	return { key: AGENT_BINDING_METADATA_KEY, value: agentId };
}

/**
 * True when `auth` owns the checkout/cart. Ownership holds when EITHER:
 *  - the checkout is bound to this agent (`ucp.agent_id` metadata === agent.id), OR
 *  - an OAuth customer's email matches the checkout email.
 *
 * Carts created before the binding existed (no metadata key) and no email
 * match → not owned → 404 (fail closed; carts are short-lived).
 */
export function ownsCheckout(
	checkout: { email: string | null; metadata: Array<{ key: string; value: string }> },
	auth: Pick<UcpRouteAuth, "agent" | "userContext">,
): boolean {
	const bound = checkout.metadata.find((m) => m.key === AGENT_BINDING_METADATA_KEY)?.value;
	if (bound && bound === auth.agent.id) return true;

	const customerEmail = normEmail(auth.userContext?.email);
	if (customerEmail && normEmail(checkout.email) === customerEmail) return true;

	return false;
}
